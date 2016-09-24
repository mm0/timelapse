import λ from 'apex.js';
import fs from 'fs';
import fsp from 'fs.promised';
import rmfr from 'rmfr';
import uuid from 'node-uuid';
import AWS from 'aws-sdk';

import ffmpeg from './ffmpegWrapper';

const DEFAULT_FPS = 30;
const FRAME_LIMIT = 10;

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

// A missing S3 object is not a reason to stop the show.
function forgivingNoSuchKey(err) {
  if (err.code === 'NoSuchKey') {
    return { Body: '' };
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

function downloadObject({ bucket, key, dest }) {
  return new Promise((resolve, reject) => {
    const stream = s3.getObject({
      Bucket: bucket,
      Key: key,
    }).createReadStream().pipe(fs.createWriteStream(dest));

    stream.on('finish', res => resolve(res));
    stream.on('error', err => reject(err));
  })
}

// Get config details from the bucket level and the camera level and merge them
function getConfig(event) {
  return Promise.all([
    s3.getObject({
      Bucket: event.bucket,
      Key: 'config.json',
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
    s3.getObject({
      Bucket: event.bucket,
      Key: `${event.cam}/config.json`,
    }).promise().catch(forgivingNoSuchKey).then(parseJsonBody),
  ])
  .then(configs => Object.assign({}, configs[0], configs[1]))
  .catch(err => {
    console.error(err);
    throw new Error(`Error while reading configs: ${err}`);
  });
}

async function processVideo(event) {
  // get config
  const config = await getConfig(event);

  // get cam index
  console.log('Updating video', event, config);
  const allImages = await s3.getObject({
    Bucket: event.bucket,
    Key: `${event.cam}/index.txt`,
  }).promise().then(data => data.Body.toString().split('\n'));

  // get last image added to video
  console.log('Getting last index', allImages)
  const lastIndex = await s3.getObject({
    Bucket: event.bucket,
    Key: `${event.cam}/last-video-index.txt`,
  }).promise().catch(forgivingNoSuchKey).then(data => data.Body.toString());

  // putting new images in order
  const images = lastIndex ? allImages.splice(0, allImages.indexOf(lastIndex)).reverse() : allImages.reverse();

  if (images.length > FRAME_LIMIT) {
    console.log('Many images to be processed', images.length, FRAME_LIMIT);
    images.length = FRAME_LIMIT;
  }

  // create a temp dir to store images to be added to video
  const tmpDir = `/tmp/${uuid.v1()}`;
  await fsp.mkdir(tmpDir);

  // downloading all new images to tmp dir
  console.log('Downloading new images', images.length);
  await Promise.all(images.map((image, i) => downloadObject({
    bucket: event.bucket,
    key: config.source ? `${event.cam}/${config.source}/${image}.jpg` : `full/${event.cam}/${image}.jpg`,
    dest: `${tmpDir}/${zp(i, 3)}.jpg`,
  })));

  let prevVideo = false;

  if (lastIndex) {
    prevVideo = `${tmpDir}-video.mp4`;
    await downloadObject({
      bucket: event.bucket,
      key: `${event.cam}/video.mp4`,
      dest: prevVideo,
    });
  }

  console.log('Creating new video file', prevVideo);
  const newVideo = await ffmpeg.convert(
    tmpDir,
    event.fps || config.video.fps || DEFAULT_FPS,
    prevVideo,
    config.video.width ? [config.video.width, config.video.height] : null,
  );

  console.log('Uploading new video and last index', newVideo);
  const res = await Promise.all([
    s3Upload({
      Bucket: event.bucket,
      Key: `${event.cam}/video.mp4`,
      Body: fs.createReadStream(newVideo),
      CacheControl: 'no-cache',
      ContentType: 'video/mp4',
    }),
    s3Upload({
      Bucket: event.bucket,
      Key: `${event.cam}/last-video-index.txt`,
      Body: images[images.length - 1],
      CacheControl: 'no-cache',
      ContentType: 'text/text',
    }),
  ]);

  // cleaning up
  console.log('Clearing temp files');
  const clearItems = [
    fsp.unlink(newVideo),
    rmfr(tmpDir),
  ];

  if (lastIndex) {
    clearItems.push(fsp.unlink(`${tmpDir}-video.mp4`));
  }

  await Promise.all(clearItems);

  return res;
}

// Lambda function entry point
export default λ(event => processVideo(event));
