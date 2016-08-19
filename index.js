'use strict';

const gm = require('gm').subClass({ imageMagick: true });
const fs = require('fs');
const AWS = require('aws-sdk');

const TMP_PATH = '/tmp/img.jpg';
const FOREVER = '31536000';
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
  ]).then(configs => Object.assign({}, configs[0], configs[1]));
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
    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/exif/${event.image.name}.txt`,
      Body: data || '\n',
      CacheControl: `max-age=${FOREVER}`,
    }, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  }));
}

function cropImage(event, crop) {
  return new Promise((resolve, reject) => {
    gm(event.tmpFile)
    .crop(crop.width, crop.height, crop.left, crop.top)
    .write(event.tmpFile, err => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

function resizeImage(event, resize) {
  return new Promise((resolve, reject) => {
    const stream = gm(event.tmpFile)
    .resize(resize.width, resize.height, resize.ignoreAspectRatio && '!')
    .quality('200', 100 - (resize.compression || DEFAULT_COMPRESSION))
    .noProfile()
    .stream();

    s3.upload({
      Bucket: event.bucket.name,
      Key: `${event.image.cam}/${resize.folder}/${event.image.name}.jpg`,
      Body: stream,
    }).send((err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  });
}

function processImage(e) {
  const event = Object.assign(e);
  event.image = parsePath(event.object.key);
  event.tmpFile = TMP_PATH;
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
  .then(() => true);
}

exports.handler = (event, context, callback) => {
  processImage(event.Records[0].s3)
    .then(res => callback(null, res))
    .catch(err => callback(err));
};