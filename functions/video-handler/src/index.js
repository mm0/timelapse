import λ from 'apex.js';
import AWS from 'aws-sdk';

function handleEC2Action(action) {
  // read instance id from env
  var instance_id = process.env.instance_id

  var ec2 = new AWS.EC2({
    apiVersion: 'latest',
    region    : "us-east-1"
  });

  console.log(ec2);

  switch (action) {
    case "start":
      var request = ec2.startInstances({
        "InstanceIds": [ instance_id ]
      },function(err,data){
        console.log(err);
        console.log(data)});
      break;
    case "stop":
      request = ec2.stopInstances({
        "InstanceIds": [ instance_id ]
      },function(err,data){
        console.log(err);
        console.log(data)});
      break;
  }

  console.log(request);

}

// Lambda function entry point
export default λ(event => handleEC2Action(event.action));