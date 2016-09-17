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

process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT']
import { exec } from 'child_process';
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

function ffmpegCreateVideoFromFrames(imageDirectory, fps) {
  return new Promise((resolve, reject) => {
    fs.readdir(imageDirectory, (err, fileNames) => {
      if (err) {
        console.error(`couldn't read directory." ${err}`);
        return reject();
      } else {
        if (fps > 30) {
          console.log('fps too high, it must be less than or equal to 30');
          return reject();
        }

        // NOTE(james): rename files from timestamp format to numbered order format
        // NOTE(james): timestamp format is something like 20160907T065144.044Z.jpg
        if (fileNames.length > 0) {
          if (fileNames.length > 999) {
            console.log('Too many images in directory! Must be less than 1000');
            return reject();
          }
        } else {
          return reject(new Error('No images to append to video.'));
        }


        const fullFileName = `/tmp/${uuidString()}.mp4`;

        // NOTE(james): FFMPEG images to video docs
        // https://trac.ffmpeg.org/wiki/Create%20a%20video%20slideshow%20from%20images

        const args = [
          '-i', `${imageDirectory}/%03d.jpg`,
          '-framerate', fps,
          '-c:v', 'libx264',
          '-r', '30',
          '-pix_fmt', 'yuv420p',
          '-y',
          fullFileName,
        ];

        // NOTE(james): final command should be something like
        // ffmpeg -y -framerate FPS -i IMAGEDIR/%03d.png -c:v libx264 -r 30 -pix_fmt yuv420p out.mp4
        console.log('Creating video from frames...', args);
        exec(['ffmpeg', ...args].join(' '), (err, stdout, stderr) => {
          if (err) {
            console.error('Error while running ffmpeg', err);
            return reject(err);
          }
          console.log('ffmpeg out', stdout);
          console.log('ffmpeg err', stderr);
          resolve(fullFileName);
        })

      }
    });
  });
}

// NOTE(james): Creates a video from images in imageDirectory at specified fps,
// appends that video to the existingVideo
function ffmpegAppendFrames(imageDirectory, fps, existingVideo) {
  return new Promise((resolve, reject) => {
    ffmpegCreateVideoFromFrames(imageDirectory, fps).then(newFramesVideoName => {
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
      const concatListName = `/tmp/${uuidString()}.txt`;
      fs.writeFile(concatListName, concatList, (concatErr) => {
        if (concatErr) {
          console.error(`concat list file write failed. ${concatErr}`);
          fs.unlink(newFramesVideoName);
          return reject();
        } else {
          const finalVideoName = `/tmp/${uuidString()}.mp4`;

          // NOTE(james): FFmpeg concatenation docs https://trac.ffmpeg.org/wiki/Concatenate
          const args = [
            '-i', concatListName,
            '-f', 'concat',
            '-c', 'copy',
            '-y',
            finalVideoName,
          ];

          console.log('Concatenating videos', args);
          exec(['ffmpeg', ...args].join(' '), (err, stdout, stderr) => {
            if (err) {
              console.error('Error while running ffmpeg', err);
              return reject(err);
            }
            console.log('ffmpeg out', stdout);
            console.log('ffmpeg err', stderr);
            resolve(finalVideoName);
          })
        }
      });
    });
  });
}

/*
NOTE(james):
Param Explanations:

fileDirectory: this is where the images are stored. This can be either absolute or
relative to the tmp folder. Must be JPEG format

fps: this is how fast the images should change in the video. The video will play at a a steady
30 FPS so this just affects how many frames the images are duplicated EX pass a 1
for each image to be displayed for one second. Must be <= 30

existingVideo (optional): the video to which new images should be appended to. This is either
an absolute path or relative to the tmp folder. Must be an mp4
*/
exports.convert = function ffmpegWrapped(fileDirectory, fps, existingVideo) {
  let func;
  if (!existingVideo) {
    func = ffmpegCreateVideoFromFrames(fileDirectory, fps);
  } else {
    func = ffmpegAppendFrames(fileDirectory, fps, existingVideo);
  }
  return func;
};
