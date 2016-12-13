import λ from 'apex.js';
import AWS from 'aws-sdk';

var ec2 = new AWS.EC2({
  apiVersion: '2016-11-15',
  region    : "us-east-1"
});

function deleteImage(event, resize) {
  return s3.deleteObject({
    Bucket: event.bucket.name,
    Key   : `${event.image.cam}/${resize.folder}/${event.image.name}.jpg`,
  }).promise();
}

async function handleEC2Action(e) {
  let instances = ['X-XXXXXXXX']

  switch (e.action) {
    case "start":
      await ec2.startInstance({
        InstanceIds: instances
      });
      break;
    case "stop":
      await ec2.stopInstance({
        InstanceIds: instances
      });
      break;
  }

}

// Lambda function entry point
export default λ(event => Promise.all(event.Records.map(req => handleEC2Action(req))));

