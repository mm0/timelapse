import λ from 'apex.js';
import fsp from 'fs.promised';
import fs from 'fs';
import uuid from 'node-uuid';
import AWS from 'aws-sdk';

import ffmpeg from './ffmpeg';

const DEFAULT_FPS = 30;

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

async function processVideo(event) {
  // get cam index
  console.log('Updating video', event);
  const allImages = s3.getObject({
    Bucket: event.bucket,
    Key: `${event.cam}/index.txt`,
  }).promise().then(data => data.Body.toString().split('\n'));

  // get last image added to video
  console.log('Getting last index')
  const lastIndex = s3.getObject({
    Bucket: event.bucket,
    Key: `${event.cam}/last-video-index.txt`,
  }).promise().catch(forgivingNoSuchKey).then(data => data.Body.toString());

  // putting new images in order
  const images = lastIndex ? allImages.splice(0, allImages.indexOf(lastIndex)).reverse() : allImages.reverse();

  // create a temp dir to store images to be added to video
  const tmpDir = `/tmp/${uuid.v1()}`;
  await fsp.mkdir(tmpDir);

  // downloading all new images to tmp dir
  console.log('Downloading new images', images.length);
  await Promise.all(images.map((image, i) => downloadObject({
    bucket: event.bucket ,
    key: `full/${event.cam}/${image}`,
    dest: `${tmpDir}/${zp(i, 3)}`,
  })));

  const prevVideo = lastIndex ?
  await downloadObject({
    bucket: event.bucket ,
    key: `${event.cam}/video.mp4`,
    dest: `${tmpDir}-video.mp4`,
  }) : false;

  console.log('Creating new video file');
  const newVideo = await ffmpeg.convert(tmpDir, DEFAULT_FPS, prevVideo);

  console.log('Uploading new video and last index');
  const res = await Promise.all([
    s3.upload({
      Bucket: event.bucket,
      Key: `${event.cam}/video.mp4`,
      Body: fs.createReadStream(newVideo),
      CacheControl: 'no-cache',
      ContentType: 'video/mp4',
    }).promise(),
    s3.upload({
      Bucket: event.bucket,
      Key: `${event.cam}/last-video-index.txt`,
      Body: images[images.length - 1],
      CacheControl: 'no-cache',
      ContentType: 'text/text',
    }).promise(),
  ]);
  return res;
}

// Lambda function entry point
export default λ(event => processVideo(event));
