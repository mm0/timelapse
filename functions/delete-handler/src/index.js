import λ from 'apex.js';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

// The S3 object path contains Camera name and the timestamp in the file name. We need extract both.
function parsePath(path) {
  const res = /^full\/(.*)\/(.*)\.jpg/.exec(path);
  return {
    cam: res[1],
    name: decodeURIComponent(res[2]),
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
  .then(configs => ({...configs[0], ...configs[1]}))
  .catch(err => {
    console.error(err);
    throw new Error(`Error while reading configs: ${err}`);
  });
}

function deleteImage(event, resize) {
  return s3.deleteObject({
    Bucket: event.bucket.name,
    Key: `${event.image.cam}/${resize.folder}/${event.image.name}.jpg`,
  }).promise();
}

async function handleDeletion(e) {
  console.log(`Processing '${decodeURIComponent(e.object.key)}' deletion ...`);
  const event = {
    ...e,
    image: parsePath(e.object.key),
  };
  const config = await getConfig(event);

  if (config.resize && config.resize.length) {
    await Promise.all(
      config.resize.map(resize => deleteImage(event, resize))
    );
  }

}

// Lambda function entry point
export default λ(event => Promise.all(event.Records.map(rec => handleDeletion(rec.s3))));
