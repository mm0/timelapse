// author: James Fulop
// NodeJs ffmpeg wrapper for turning collections of images to videos
// date: September 8: 2016

process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT']
import { exec } from 'child_process';

// NOTE(james): to concatenate videos, we must create a text list for ffmpeg to read
// we also need this to rename temp files
const fs = require('fs');

// NOTE(james): need a unique name for temp files
const uuid = require('node-uuid');

const ffprobe = require('node-ffprobe');

// NOTE(james): depends on https://github.com/broofa/node-uuid
function uuidString() {
  const uuidArray = new Array(32);
  uuid.v1(null, uuidArray, 0);
  return uuid.unparse(uuidArray);
}

function ffmpegCreateVideoFromFrames(imageDirectory, fps, resolution) {
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

        ffprobe(`${imageDirectory}/001.jpg`, (ffprobeErr, ffprobeInfo) => {
          if (ffprobeErr) {
            console.log('could not probe first image file, it should be named 001.jpg');
            return reject(err);
          }
          if (!resolution) {
            resolution = [ffprobeInfo.streams[0].width, ffprobeInfo.streams[0].height];
          }
          let resolutionArg = `scale=${resolution[0]}:${resolution[1]}`;
          const args = [
            //'-v', '9',
            //'-loglevel', '99',
            '-framerate', fps,
            '-i', `${imageDirectory}/%03d.jpg`,
            '-c:v', 'libx264',
            '-r', '30',
            '-vf', resolutionArg,
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
        });
      }
    });
  });
}

// NOTE(james): Creates a video from images in imageDirectory at specified fps,
// appends that video to the existingVideo
function ffmpegAppendFrames(imageDirectory, fps, existingVideo, resolution) {
  return new Promise((resolve, reject) => {
    ffprobe(existingVideo, (ffprobeErr, ffprobeInfo) => {
      if (ffprobeErr) {
        return reject(ffprobeErr);
      }
      var existingVideoResolution = [ffprobeInfo.streams[0].width, ffprobeInfo.streams[0].height];

      // NOTE(james): if a resolution wasn't provided, maintain existing video resolution
      var newFramesVideoResolution = (resolution) ? resolution : existingVideoResolution;
      ffmpegCreateVideoFromFrames(imageDirectory, fps, newFramesVideoResolution).then(newFramesVideoName => {
        console.log('Concatenating video...');

        const existingVideoNameSliced = existingVideo.slice(0, existingVideo.lastIndexOf('.'));
        const resizedExistingVideo = `${existingVideoNameSliced}-resized.mp4`;
        
        /*
          NOTE(james): ffmpeg needs a list of files to be concatenated, so the output
          of this file is something like

          file 'resizedExistingVideo.mp4'
          file 'newFramesVideoOuput.mp4'

          The concatenation file is deleted at the end of this program
        */
        const concatList = `file \'../${resizedExistingVideo}\'\r\nfile \'../${newFramesVideoName}\'\r\n`;

        const concatListName = `/tmp/${uuidString()}.txt`;
        console.log(concatListName);
        fs.writeFile(concatListName, concatList, (concatErr) => {
          if (concatErr) {
            console.error(`concat list file write failed. ${concatErr}`);
            fs.unlink(concatListName, function() {
              fs.unlink(newFramesVideoName, function() {
                return reject();
              });
            });
          } else {
            /*
              NOTE(james): resize old video before appending, in case we are starting to use a new size
              TODO(james): This could be skipped by checking resolution vs existingVideoResolution,
              but I'm not sure how to have an optional promise-then here
            */

            if (!resolution) {
              resolution = existingVideoResolution;
            }
            const resolutionArg = `scale=${resolution[0]}:${resolution[1]}`;
            const args = [
              //'-v', '9',
              //'-loglevel', '99',
              '-i', existingVideo,
              '-vf', resolutionArg,
              '-y',
              resizedExistingVideo,
            ];

            exec(['ffmpeg', ...args].join(' '), (resizeErr, resizeStdOut, resizeStdErr) => {
              if (resizeErr) {
                console.error(`resizing existing video failed. ${resizeStdErr}`);
                fs.unlink(concatListName, function() {
                  fs.unlink(newFramesVideoName, function() {
                    return reject();
                  });
                });
              } else {
                const finalVideoName = `/tmp/${uuidString()}.mp4`;

                // NOTE(james): FFmpeg concatenation docs https://trac.ffmpeg.org/wiki/Concatenate
                const concatArgs = [
                  //'-v', '9',
                  //'-loglevel', '99',
                  '-safe', 0,
                  '-f', 'concat',
                  '-i', concatListName,
                  '-c', 'copy',
                  '-y',
                  finalVideoName,
                ];

                console.log('Concatenating videos', concatArgs);
                exec(['ffmpeg', ...concatArgs].join(' '), (err, stdout, stderr) => {
                  if (err) {
                    console.error('Error while running ffmpeg', err);
                    fs.unlink(concatListName, function() {
                      fs.unlink(newFramesVideoName, function() {
                        fs.unlink(resizedExistingVideo, function() {
                          return reject(err);
                        });
                      });
                    });
                  }
                  console.log('ffmpeg out', stdout);
                  console.log('ffmpeg err', stderr);
                  
                  //OPTIMIZE(james): these could run in parallel
                  fs.unlink(concatListName, function() {
                    fs.unlink(newFramesVideoName, function() {
                      fs.unlink(resizedExistingVideo, function() {
                        resolve(finalVideoName);
                      });
                    });
                  });
                })
              }
            })
          }
        });
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

resolution array [width,height](optional): define an output resolution for the video. Any
inputs that are a different resolution from this will be uniformly scaled until the width or
height matches the requested resolution, then letterboxed. If this param is omitted, the determined
resolution depends on if there is an existing video or not.if there is an existing video, the output
will  be the same resolution. Otherwise, the video is the resolution of the first image in the series
provided.
*/
exports.convert = function ffmpegWrapped(fileDirectory, fps, existingVideo, resolution) {
  let func;
  if (!existingVideo) {
    func = ffmpegCreateVideoFromFrames(fileDirectory, fps, resolution);
  } else {
    func = ffmpegAppendFrames(fileDirectory, fps, existingVideo, resolution);
  }
  return func;
};
