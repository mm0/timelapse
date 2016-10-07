import λ from 'apex.js';
import piexif from 'piexifjs';
import fs from 'fs';
import fsp from 'fs.promised';
import uuid from 'node-uuid';
import AWS from 'aws-sdk';
import getRawBody from 'raw-body';

const gm = require('gm').subClass({ imageMagick: true });

const FOREVER = '31536000'; // = 365 days, longest allowed max-age
const DEFAULT_QUALITY = 0; // retain 100% quality by default
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

// The script will only index 5000 latest images.
// Older images will be in S3, but not in the index files.
const MAX_INDEX_COUNT = 5000;

// The S3 object path contains Camera name and the timestamp in the file name. We need extract both.
function parsePath(path) {
  const res = /^full\/(.*)\/(.*)\.jpg/.exec(path);
  return {
    cam: res[1],
    name: res[2],
  };
}

// A missing S3 object is not a reason to stop the show.
function forgivingNoSuchKey(err) {
  if (err.code === 'NoSuchKey') {
    return { Body: '' };
  }
  throw err;
}

function parseJsonBody(data) {
  return JSON.parse(data.Body.toString() || '{}');
}

// File names are timestamps in ISO format with - and : removed. E.g. 20161023T130005.367Z.jpg
function toISO(date) {
  return date.toISOString().replace(/-/g, '');
}

function daysAgo(date, days) {
  return new Date((new Date()).setDate(date.getDate() - days));
  // TODO: Add a parameter for resetting the hours so that it's counting whole days only.
  // E.g. If it's Monday, it shouldn't show images from Sunday for 7 days back,
  // even though they are less than 168 hrs old.
}

// Get config details from the bucket level and the camera level and merge them
function getConfig(event) {
  return Promise.all([
    s3.getObject({
      Bucket: event.bucket.name,
      Key: 'config.json',
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
    s3.getObject({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/config.json`,
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
  ])
  .then(configs => Object.assign({}, configs[0], configs[1]))
  .catch(err => {
    console.error(err);
    throw new Error(`Error while reading configs: ${err}`);
  });
}

function updateIndex(event) {
  console.log('Updating main index ...');
  return s3.getObject({
    Bucket: event.bucket.name,
    Key: `${event.image.cam}/index.txt`,
  }).promise()
  .catch(forgivingNoSuchKey)
  .then(res => {
    const data = res.Body.toString();
    let items = data ? data.split('\n') : [];
    // TODO: Potentially can get out of sync. Replace with reading the last N records
    // from s3:ListObjects or think of a better way.
    items.push(event.image.name);

    // Sort descending
    items.sort((a, b) => +(a < b) || +(a === b) - 1);

    // Dedupping
    items = Array.from(new Set(items));

    // Truncate
    if (items.length > MAX_INDEX_COUNT) {
      items.length = MAX_INDEX_COUNT;
    }

    return items;
  })
  .then(items => new Promise((resolve, reject) => {
    console.log('Storing new index.');
    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/index.txt`,
      Body: items.join('\n'),
      CacheControl: 'no-cache',
      ContentType: 'text/text',
    }, err => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while storing index: ${err}`));
      }
      return resolve(items);
    });
  }))
  .then(items => {
    const date = new Date();

    const i30days = items.filter(name => name > toISO(daysAgo(date, 30)));
    const i7days = i30days.filter(name => name > toISO(daysAgo(date, 7)));
    const i24hr = i7days.filter(name => name > toISO(daysAgo(date, 1)));
    const today = i24hr.filter(name => name.startsWith(toISO(date).slice(0, 8)));

    return {
      last: [items[0]],
      last100: items.slice(0, 100),
      today,
      '24hr': i24hr,
      '7days': i7days,
      '30days': i30days,
    };
  })
  .catch(err => {
    console.error(err);
    throw new Error(`Error while updating main index: ${err}`);
  });
}

// Read EXIF from the original image and store it as a txt file in S3
function extractExif(event) {
  return new Promise((resolve, reject) => {
    gm(event.tmpFile).identify('%[EXIF:*]', (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  }).then(data => new Promise((resolve, reject) => {
    console.log(`Storing EXIF data, ${data.split('\n').length} item(s)`);
    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/exif/${event.image.name}.txt`,
      Body: data || '\n',
      CacheControl: `max-age=${FOREVER}`,
      ContentType: 'text/text', //TODO: make it a constant
    }, (err, res) => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while storing EXIF data: ${err}`));
      }
      return resolve(res);
    });
  }));
}

// Auto Orient and Remove exif from the temporary file
// except for a few tags from the config file before resizing.
function clearExifAndAutoOrient(event, retain) {
  console.log('Clearing EXIF data retaining', retain);
  return fsp.readFile(event.tmpFile)
  .then(jpeg => {
    const data = jpeg.toString('binary');
    const exifObj = piexif.load(data);
    const newExif = {};
    const new0th = {};
    const new1st = {};

    for (let i = 0; i < retain.length; i++) {
      const k = piexif.ExifIFD[retain[i]] || piexif.ImageIFD[retain[i]];

      if (k && exifObj.Exif[k] !== undefined) {
        newExif[k] = exifObj.Exif[k];
      } else if (k && exifObj['0th'][k] !== undefined) {
        new0th[k] = exifObj['0th'][k];
      } else if (k && exifObj['1st'][k] !== undefined) {
        new1st[k] = exifObj['1st'][k];
      }
    }
    exifObj.Exif = newExif;
    exifObj['0th'] = new0th;
    exifObj['1st'] = new1st;

    const exifbytes = piexif.dump(exifObj);

    console.log('Auto Orienting Image');
    return getRawBody(gm(event.tmpFile).autoOrient().noProfile().stream())
    .then(buf => {
      console.log('buf', buf);
      const newData = piexif.insert(exifbytes, buf.toString('binary'));
      const newJpeg = new Buffer(newData, 'binary');
      console.log('Adding retained EXIF data', retain);
      return fsp.writeFile(event.tmpFile, newJpeg);
    });
  });
}

function cropAndRotateImage(event, crop, rotate) {
  console.log('Cropping and rotating image', crop, rotate);
  return new Promise((resolve, reject) => {
    // TODO: investigate if it's possible to feed in-memory stream to GM
    // instead of saving intermediate files.
    const res = gm(event.tmpFile);

    if(rotate && rotate.degrees){
      res.rotate(rotate.color || 'black', rotate.degrees)
    }

    if(crop){
      res.crop(crop.width, crop.height, crop.left, crop.top)
    }

    res.write(event.tmpFile, err => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while cropping image: ${err}`));
      }
      return resolve();
    });
  });
}

function resizeImageAndUpdateIndex(event, resize, index) {
  console.log('Resizing image', resize);
  return new Promise((resolve, reject) => {
    gm(event.tmpFile)
    // TODO: Do we check for the original image size? Only Shrink Larger Images ('>' flag)
    .resize(resize.width, resize.height, resize.ignoreAspectRatio && '!')
    // TODO: Specify an interpolation method to try a few different ones. Start with bicubic.
    .quality(resize.quality || DEFAULT_QUALITY)
    .stream((err, stdout, stderr) => {
      if(err) {
        console.error('Error while resizing', resize, stderr);
        return reject(err);
      }
      s3.upload({
        Bucket: event.bucket.name,
        Key: `${event.image.cam}/${resize.folder}/${event.image.name}.jpg`,
        ContentType: 'image/jpeg', // TODO: Move MIME types to a constant.
        Body: stdout,
      }, (err, data) => {
        if (err) {
          console.error(err);
          return reject(new Error(`Error while resizing '${resize.folder}' image: ${err}`));
        }
        return resolve(data);
      });
    });

  }).then((res) => Promise.all(Object.keys(index).map(idx => new Promise((resolve, reject) => {
    const absUrl = /(.*)\/([^\/]*)$/.exec(res.Location)[1];
    const key = `${event.image.cam}/${resize.folder}/idx/${idx}.txt`;
    console.log('Updating index', key, index[idx]);
    s3.upload({
      Bucket: event.bucket.name,
      Key: key,
      ContentType: 'text/text',
      Body: index[idx].map(name => `${absUrl}/${name}.jpg`).join('\n') || '\n',
    }, (err, data) => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while updating '${resize.folder} 'index image: ${err}`));
      }
      return resolve(data);
    });
  }))));
}

// The top level function after the entry point
function processImage(e) {
  console.log(`Processing '${e.object.key}'...`);
  const event = Object.assign({}, e, {
    image: parsePath(e.object.key),
    tmpFile: `/tmp/${uuid.v4()}`,
  });
  return new Promise((resolve, reject) => {
    const stream = s3.getObject({
      Bucket: event.bucket.name,
      Key: event.object.key,
    }).createReadStream().pipe(fs.createWriteStream(event.tmpFile));

    stream.on('finish', res => resolve(res));
    stream.on('error', err => reject(err));
  })
  .then(() => getConfig(event))
  .then(config => {
    console.log('using config', config);
    return extractExif(event)
    .then(() => clearExifAndAutoOrient(event, config['exif-retain']))
    .then(() => {
      if (config.crop || config.rotate) {
        return cropAndRotateImage(event, config.crop, config.rotate);
      }
      return true;
    })
    .then(() => updateIndex(event).then(index => {
      if (config.resize && config.resize.length) {
        return Promise.all(
          config.resize.map(resize => resizeImageAndUpdateIndex(event, resize, index))
        );
      }
      return true;
    }));
  })
  .then(() => fsp.unlink(event.tmpFile))
  .then(() => true);
}

// Lambda function entry point
export default λ(event => processImage(event.Records[0].s3));
