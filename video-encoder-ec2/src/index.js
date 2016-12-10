import fs from 'fs';
import fsp from 'fs.promised';
import rmfr from 'rmfr';
import AWS from 'aws-sdk';
import ffmpeg from './ffmpegWrapper';
import {execSync} from 'child_process';

const DEFAULT_FPS         = 30;
const DEFAULT_FRAME_LIMIT = 30;

const s3 = new AWS.S3({apiVersion: '2006-03-01'});

// A missing S3 object is not a reason to stop the show.
function forgivingNoSuchKey(err) {
  if (err.code === 'NoSuchKey') {
    return {Body: ''};
  }
  throw err;
}

// zero padder
function zp(n, c) {
  const s = String(n);
  if (s.length < c) {
    return zp('0' + n, c);
  } else {
    return s;
  }
}

function parseJsonBody(data) {
  return JSON.parse(data.Body.toString() || '{}');
}

function s3Upload(params) {
  return new Promise((resolve, reject) => {
    s3.upload(params, (err, res) => {
      if (err) {
        console.error(err);
        return reject(new Error(`Error while storing ${params.Key}: ${err}`));
      }
      return resolve(res);
    })
  })
}

async function downloadObject({bucket, key, dest}) {
  console.log('Downloading Object to', dest);
  return new Promise((resolve, reject) => {
    let file = fs.createWriteStream(dest);
    file.on('close', () => resolve());
    s3.getObject({
      Bucket: bucket,
      Key   : key,
    }).createReadStream().pipe(file);
    file.on('finish', () => {
      console.log('Finished Downloading', dest);
      return resolve();
    });
    file.on('error', reject);
  })
}

async function getObjectContent({bucket, key}) {
  console.log('Getting Object', bucket, key);
  return new Promise((resolve, reject) => {
    s3.getObject({
      Bucket: bucket,
      Key   : key
    }, function (err, output) {
      console.log(err);
      console.log(output);
      resolve(output.Body.toString());
    });
  });
}

async function doesKeyExist({bucket, key}) {
  console.log("Checking", bucket, key);
  return new Promise((resolve, reject) => {
    s3.headObject({
      Bucket: bucket,
      Key   : key
    }, function (err, metadata) {
      if (err && err.code === 'NotFound') {
        // Handle no object on cloud here
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
// Get config details from the bucket level and the camera level and merge them
function getConfig(event) {
  return Promise.all([
    s3.getObject({
      Bucket: event.bucket,
      Key   : 'config.json',
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
    s3.getObject({
      Bucket: event.bucket,
      Key   : `${event.cam}/config.json`,
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
  ]).then(configs => Object.assign({}, configs[0], configs[1])).catch(err => {
    console.error(err);
    throw new Error(`Error while reading configs: ${err}`);
  });
}

async function processVideo(event) {
  return new Promise(async(resolve, reject) => {
    // get config
    const config = await
    getConfig(event);
    const frameLimit = config.video.frameLimit || DEFAULT_FRAME_LIMIT;

    let imagesRemained = true;
    // get cam index
    console.log('Found config', config);

    // fetch entire images database
    console.log('Checking if index exists');
    let doesIndexFileExist = await
    doesKeyExist({
      bucket: event.bucket,
      key   : `${event.cam}/index.txt`
    });
    if (!doesIndexFileExist) {
      console.log("Index not found");
      throw new Error('Unable to find index file for', event.bucket, event.cam);
    }
    console.log("Index found");
    let allImages = (await
    getObjectContent({
      bucket: event.bucket,
      key   : `${event.cam}/index.txt`
    })
    ).
    split('\n');

    console.log('All Images', allImages);

    // fetch last image index
    console.log('Checking if last index exists');
    let doesLastIndexFileExist = await
    doesKeyExist({
      bucket: event.bucket,
      key   : `${event.cam}/last-video-index.txt`
    });
    if (doesLastIndexFileExist) {
      console.log('Getting last index');
      var lastIndex = await
      getObjectContent({
        bucket: event.bucket,
        key   : `${event.cam}/last-video-index.txt`
      });
      console.log('Last index', lastIndex);
    } else {
      var lastIndex = false;
      console.log('Last index not found');
    }

    // remove missing images from list
    let imagesThatExist = [];
    console.log('Removing missing images from array');
    await
    Promise.all(allImages.map(async(image, i) => {

      let image_key = config.video.source ? `${event.cam}/${config.video.source}/${image}.jpg` : `full/${event.cam}/${image}.jpg`;

      let exists = await doesKeyExist({
        bucket: event.bucket,
        key   : image_key
      });
      if (exists) {
        imagesThatExist.push(image);
      }
    }));
    console.log('Images that exist', imagesThatExist);
    // putting new images in order since async pushed to array
    imagesThatExist.sort();
    if (doesLastIndexFileExist) {
      let index = imagesThatExist.indexOf(lastIndex);
      if (index > -1) {
        imagesThatExist.splice(0, index); //delete up to index
      }
    }
    // testing
    // imagesThatExist.splice(0,imagesThatExist.length-30);
    imagesThatExist.reverse();
    console.log("Using sorted images", imagesThatExist);

    // create a temp dir to store images to be added to video
    console.log("Creating Temporary Directory");
    // unix way
    const temp_dir_prefix = 'timelapse-hubsy';
    let tmpDir            = execSync(`mktemp -d -t ${temp_dir_prefix}-XXXXXXX`).toString().replace(/\s/g, '');
    console.log('Created', tmpDir);

    // downloading all new images to tmp dir
    console.log('Downloading new images', imagesThatExist.length);
    console.log('Config is', config);
    await
    Promise.all(imagesThatExist.map(async(image, i) => {
        let image_key = config.video.source ? `${event.cam}/${config.video.source}/${image}.jpg` : `full/${event.cam}/${image}.jpg`;
        console.log('Image key', image_key);
        await downloadObject({
          bucket: event.bucket,
          key   : image_key,
          dest  : `${tmpDir}/${zp(i, 3)}.jpg`
        });
      }
    ));

    console.log("Finished Downloading Images");

    if (lastIndex) {
      console.log('Using existing video', lastIndex);
      var prevVideo = `${tmpDir}/video.mp4`;
      await
      downloadObject({
        bucket: event.bucket,
        key   : `${event.cam}/video.mp4`,
        dest  : prevVideo,
      });
    } else {
      console.log('Creating new video file');
      var prevVideo = false;

    }
    const newVideo = await
    ffmpeg.convert(
      tmpDir,
      event.fps || config.video.fps || DEFAULT_FPS,
      prevVideo,
      config.video.width ? [config.video.width, config.video.height] : null,
    );

    // TODO: test upload and cleanup
    console.log('Uploading new video and last index', newVideo);
    await
    Promise.all([
      s3Upload({
        Bucket      : event.bucket,
        Key         : `${event.cam}/video.mp4`,
        Body        : fs.createReadStream(newVideo),
        CacheControl: 'no-cache',
        ContentType : 'video/mp4',
      }),
      s3Upload({
        Bucket      : event.bucket,
        Key         : `${event.cam}/last-video-index.txt`,
        Body        : images[images.length - 1],
        CacheControl: 'no-cache',
        ContentType : 'text/text',
      }),
    ].map(async(res) => true));

    // cleaning up
    console.log('Clearing temp files');
    const clearItems = [
      fsp.unlink(newVideo),
      rmfr(tmpDir),
    ];

    if (lastIndex) {
      clearItems.push(fsp.unlink(`${tmpDir}/video.mp4`));
    }

    await
    Promise.all(clearItems.map(async(res) => true));
    resolve();
  });
}

async function main(){
  // Entry point
  let event = {
    bucket: "hubsy-timelapse-2",
    cam   : "cam6mb"
  };
  console.time('processVideo');
  let func = await processVideo(event);
  console.timeEnd('processVideo');
}
main();