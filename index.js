'use strict';

const gm = require('gm').subClass({ imageMagick: true });
const piexif = require("piexifjs");
const fs = require('fs');
const fsp = require('fs-promise');
const uuid = require('node-uuid');
const AWS = require('aws-sdk');

const FOREVER = '31536000'; // = 365 days, longest allowed max-age
const DEFAULT_COMPRESSION = 0;
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

function parsePath(path) {
  const res = /^full\/(.*)\/(.*)\.jpg/.exec(path);
  return {
    cam: res[1],
    name: res[2],
  };
}

function configNoSuchKeyHandler(err) {
  if (err.code === 'NoSuchKey') {
    return { Body: '{}' };
  }
  throw err;
}

function parseJsonBody(data) {
  return JSON.parse(data.Body.toString());
}

function getObject(params) {
  return new Promise((resolve, reject) => {
    s3.getObject(params, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

function getConfig(event) {
  return Promise.all([
    getObject({
      Bucket: event.bucket.name,
      Key: 'config.json',
    }).catch(configNoSuchKeyHandler).then(parseJsonBody),
    getObject({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/config.json`,
    }).catch(configNoSuchKeyHandler).then(parseJsonBody),
  ])
  .then(configs => Object.assign({}, configs[0], configs[1]))
  .catch(err => {
    console.error(err);
    throw new Error(`Error while reading configs: ${err}`);
  });
}

function extractExif(event) {
  return new Promise((resolve, reject) => {
    gm(event.tmpFile).identify('%[EXIF:*]', (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  }).then(data => new Promise((resolve, reject) => {
    console.log('Storing EXIF data', data);
    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/exif/${event.image.name}.txt`,
      Body: data || '\n',
      CacheControl: `max-age=${FOREVER}`,
    }, (err, res) => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while storing EXIF data: ${err}`));
      }
      return resolve(res);
    });
  }));
}

function clearExif(event, retain) {
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
    const newData = piexif.insert(exifbytes, data);
    const newJpeg = new Buffer(newData, 'binary');

    return fsp.writeFile(event.tmpFile, newJpeg);
  });
}

function cropImage(event, crop) {
  console.log('Cropping image', crop);
  return new Promise((resolve, reject) => {
    gm(event.tmpFile)
    .crop(crop.width, crop.height, crop.left, crop.top)
    .write(event.tmpFile, err => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while cropping image: ${err}`));
      }
      return resolve();
    });
  });
}

function resizeImage(event, resize) {
  console.log('Resizing image', resize);
  return new Promise((resolve, reject) => {
    const stream = gm(event.tmpFile)
    .resize(resize.width, resize.height, resize.ignoreAspectRatio && '!')
    .quality(100 - (resize.compression || DEFAULT_COMPRESSION))
    .stream();

    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/${resize.folder}/${event.image.name}.jpg`,
      Body: stream,
    }).send((err, data) => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while resizing image: ${err}`));
      }
      return resolve(data);
    });
  });
}

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
    .then(() => clearExif(event, config['exif-retain']))
    .then(() => {
      if (config.crop) {
        return cropImage(event, config.crop);
      }
      return true;
    })
    .then(() => {
      if (config.resize && config.resize.length) {
        return Promise.all(config.resize.map(resize => resizeImage(event, resize)));
      }
      return true;
    });
  })
  .then(() => fsp.unlink(event.tmpFile))
  .then(() => true);
}

exports.handler = (event, context, callback) => {
  processImage(event.Records[0].s3)
    .then(res => callback(null, res))
    .catch(err => callback(err.stack));
};
