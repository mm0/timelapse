// author: James Fulop
// NodeJs ffmpeg wrapper for turning collections of images to videos
// date: September 8: 2016

/*
    Commandline structure is either
    A. To create a new video from frames
        node ffmpegWrapper.js imageDirectory fps
    B. To append frames to an existing video
        node ffmpegWrapper.js imageDirectory fps existingVideo.mp4

    Images must be jpgs. They must be padded to 3 digits with zeros, so
    001.jpg, 002.jpg...010.jpg...100.jpg

    fps must be less than 30

    existing video must be an mp4
*/

// NOTE(james): lets us execute other programs (ffmpeg), must do work synchronously
const execSync = require('child_process').execSync;

// NOTE(james): to concatenate videos, we must create a text list for ffmpeg to read
// we also need this to rename temp files
const fs = require('fs');

function platformFFmpegCallingConvention() {
  let result = '';
  if (process.platform === 'win32') {
    result = 'ffmpeg';
  } else if (process.platform === 'linux') {
    result = './ffmpeg';
  } else {
    console.log('Unsupported OS!');
  }
  return result;
}

function addAudio() {
  // TODO(james): placeholder
  fs.renameSync('finalVideoNoAudio.mp4', 'finalVideo.mp4');
}

/*
    NOTE(james): creates a video from the images in imageDirectory at specified fps,
    if its beingAppended the output video name is "newFramesVideoOutput.mp4", otherwise
    it is "finalVideoNoAudio.mp4"
*/
function ffmpegCreateVideoFromFrames(imageDirectory, fps, beingAppended) {
  const fileNames = fs.readdirSync(imageDirectory);
  console.log('Creating video from frames...');

  if (fps > 30) {
    console.log('fps too high, it must be less than or equal to 30');
    return;
  }

  // NOTE(james): rename files from timestamp format to numbered order format
  // NOTE(james): timestamp format is something like 20160907T065144.044Z.jpg
  if (fileNames.length > 0) {
    if (fileNames.length > 999) {
      console.log('Too many images in directory! Must be less than 1000');
      return;
    }

    console.log('sorting image files...');
    for (let fileIndex = 0; fileIndex < fileNames.length; fileIndex++) {
      const fileName = fileNames[fileIndex];
      const extension = fileName.slice(fileName.lastIndexOf('.'));
      if (extension !== '.jpg') {
        console.log('File in image directory isn\'t a jpg');
        return;
      }
    }
    fileNames.sort();

    for (let fileIndex = 0; fileIndex < fileNames.length; fileIndex++) {
      let newName;// NOTE(james): flagged by linter. It's used in the newPath string
      if (fileIndex < 10) {
        newName = `00${fileIndex}`;
      } else if (fileIndex < 100) {
        newName = `0${fileIndex}`;
      } else {
        newName = fileIndex.toString();
      }
      const currentName = fileNames[fileIndex];
      const oldPath = `${imageDirectory}/${currentName}`;
      const newPath = `${imageDirectory}/${newName}.jpg`;
      fs.renameSync(oldPath, newPath);
    }
  }

  const videoName = (beingAppended) ? 'newFramesVideoOutput.mp4' : 'finalVideoNoAudio.mp4';

  // NOTE(james): FFMPEG images to video docs
  // https://trac.ffmpeg.org/wiki/Create%20a%20video%20slideshow%20from%20images

  let command = `${platformFFmpegCallingConvention()} -y `;
  command += `-framerate ${fps} `;
  command += `-i ${imageDirectory}/%03d.jpg `;
  command += `-c:v libx264 -r 30 -pix_fmt yuv420p ${videoName}`;

  // NOTE(james): final command should be something like
  // ffmpeg -y -framerate FPS -i IMAGEDIR/%03d.png -c:v libx264 -r 30 -pix_fmt yuv420p out.mp4
  execSync(command);
  console.log('Created video from frames!');
}

// NOTE(james): Creates a video from images in imageDirectory at specified fps,
// appends that video to the existingVideo
// NOTE(james): existingVideo triggers linter. It's used in concatList
function ffmpegAppendFrames(imageDirectory, fps, existingVideo) {
  ffmpegCreateVideoFromFrames(imageDirectory, fps, true);
  console.log('Concatenating video...');

/*
  NOTE(james): ffmpeg needs a list of files to be concatenated, so the output
  of this file is something like

  file 'existingVideo.mp4'
  file 'newFramesVideoOuput.mp4'

  The concatenation file is deleted at the end of this program
*/
  const concatList = `$file \'${existingVideo}\'\r\nfile \'newFramesVideoOutput.mp4\'\r\n`;

  fs.writeFileSync('concatList.txt', concatList);

  // NOTE(james): FFmpeg concatenation docs https://trac.ffmpeg.org/wiki/Concatenate
  let command = platformFFmpegCallingConvention();
  command += ' -y -f concat';
  command += ' -i concatList.txt -c copy finalVideoNoAudio.mp4';

  execSync(command);

  fs.unlink('newFramesVideoOutput.mp4'); // NOTE(james): deleting the temp video
  fs.unlink('concatList.txt'); // NOTE(james): deleting the concatList

  console.log('Concatenated video!');
}

const args = process.argv;
function offlineCLI() {
  /*
      NOTE(james): args array looks like
          ['node', 'ffmpegWrapper.js', 'imageDirectory', '3', 'existingVideo']
  */
  if (args[2] && args[3] && args[4]) {
    ffmpegAppendFrames(args[2], args[3], args[4]);
    addAudio();
  } else if (args[2] && args[3]) {
    ffmpegCreateVideoFromFrames(args[2], args[3], false);
    addAudio();
  } else {
    let wrapperArgs = '';
    wrapperArgs += 'imageDir-directory local to file. Must be jpgs. Ex. resources/images\n';
    wrapperArgs += 'FPS-video is 30 fps, this determines how many frames each image is duped\n';
    wrapperArgs += '[optional]existingVideo-video appendee. Must be mp4\n';

    console.log(`bad wrapper arguments.\n${wrapperArgs}`);
    return;
  }


  //
  // Upload finalVideo.mp4 to S3 here
  //
}

// NOTE(james): if main hasn't been set, like I think it would be in AWS,
// then we are using the offline CLI
if (require.main === module) {
  offlineCLI();
}
/*
// NOTE(james): AWS Path
exports.handler = (event, context, callback) =>
{
    if (event.cmd)
    {
        ffmpeg(event.cmd);
    } else
    {
        callback(error, 'No command argument');
    }
};
*/
