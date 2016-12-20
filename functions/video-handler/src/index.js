import λ from 'apex.js';
import AWS from 'aws-sdk';

async function handleEC2Action(action, instance_ids) {

  var ec2 = new AWS.EC2({
    apiVersion: '2016-11-15',
    region    : "us-east-1"
  });

  switch (action) {
    case "start":
      await ec2.startInstance({
        InstanceIds: instance_ids
      });
      break;
    case "stop":
      await ec2.stopInstance({
        InstanceIds: instance_ids
      });
      break;
  }

}

// Lambda function entry point
export default λ(event => handleEC2Action(event.action, event.instance_ids));

