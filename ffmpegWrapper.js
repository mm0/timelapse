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
'use strict';

// NOTE(james): lets us execute other programs (ffmpeg)
const exec = require('child_process').exec;

// NOTE(james): to concatenate videos, we must create a text list for ffmpeg to read
// we also need this to rename temp files
const fs = require('fs');

// NOTE(james): need a unique name for temp files
const uuid = require('node-uuid');

// NOTE(jamse): depends on https://github.com/broofa/node-uuid
function uuidString() {
  const uuidArray = new Array(32);
  uuid.v1(null, uuidArray, 0);
  return uuid.unparse(uuidArray);
}

/* // NOTE(james) hold on this for now
function addAudio() {
  // TODO(james): placeholder
  fs.renameSync('finalVideoNoAudio.mp4', 'finalVideo.mp4');
}
*/

/*
    NOTE(james): creates a video from the images in imageDirectory at specified fps,
    if its beingAppended the output video name is "newFramesVideoOutput.mp4", otherwise
    it is "finalVideoNoAudio.mp4"
*/

function ffmpegCreateVideoFromFrames(imageDirectory, fps, beingAppended) {
  return new Promise(() => {
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
        let newName;
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

        /*
        HELP(james): not sure how to make this async. I think I could make an array
        of the Promises then do a Promise.all(...) to wait for them. I couldn't make
        it work though
        */
        fs.renameSync(oldPath, newPath);
      }
    }

    const videoName = (beingAppended) ? 'newFramesVideoOutput.mp4' : 'finalVideoNoAudio.mp4';

    // NOTE(james): FFMPEG images to video docs
    // https://trac.ffmpeg.org/wiki/Create%20a%20video%20slideshow%20from%20images

    let command = `./ffmpeg -y `;
    command += `-framerate ${fps} `;
    command += `-i ${imageDirectory}/%03d.jpg `;
    command += `-c:v libx264 -r 30 -pix_fmt yuv420p ${videoName}`;

    // NOTE(james): final command should be something like
    // ffmpeg -y -framerate FPS -i IMAGEDIR/%03d.png -c:v libx264 -r 30 -pix_fmt yuv420p out.mp4

    // HELP(james): I want to wait exec to complete,
    // then return the filename at the top level function
    exec(command, (error) => {
      if (error) {
        console.error(`exec error: ${error}`);
      } else {
        console.log('Created video from frames!');
      }
    }).then(() => { return videoName; });
  });
}

// NOTE(james): Creates a video from images in imageDirectory at specified fps,
// appends that video to the existingVideo
function ffmpegAppendFrames(imageDirectory, fps, existingVideo) {
  return new Promise(() => {
    ffmpegCreateVideoFromFrames(imageDirectory, fps, true).then(newFramesVideoName => {
      //HELP(james): this is never hit
      console.log('Concatenating video...');

    /*
      NOTE(james): ffmpeg needs a list of files to be concatenated, so the output
      of this file is something like

      file 'existingVideo.mp4'
      file 'newFramesVideoOuput.mp4'

      The concatenation file is deleted at the end of this program
    */
      const concatList = `file \'${existingVideo}\'\r\nfile \'${newFramesVideoName}\'\r\n`;

      // NOTE(james): need a unique name for the concat list since its a temp file
      const concatListName = `tmp/${uuidString()}.txt`;
      fs.writeFile(concatListName, concatList).then(() => {
        // NOTE(james): FFmpeg concatenation docs https://trac.ffmpeg.org/wiki/Concatenate
        let command = platformFFmpegCallingConvention();
        command += ' -y -f concat';
        command += ' -i concatList.txt -c copy finalVideoNoAudio.mp4';

        exec(command).then(() => {
          fs.unlink(newFramesVideoName); // NOTE(james): deleting the temp video
          fs.unlink(concatListName); // NOTE(james): deleting the concatList

          console.log('Concatenated video!');
        });
      });
    });
  });
}

exports.convert = function (fileDirectory, fps, existingVideo) {
  let func;
  if (typeof existingVideo === 'undefined') {
    func = ffmpegCreateVideoFromFrames(fileDirectory, fps, false);
  } else {
    func = ffmpegAppendFrames(fileDirectory, fps, existingVideo);
  }
  return func;
};
