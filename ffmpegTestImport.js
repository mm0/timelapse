'use strict'

const ffmpeg = require('./ffmpegWrapper');

ffmpeg.convert('resources/images', 1, 'resources/debugVideo.mp4').then(function (filename) {
  console.log('completed', filename);// HELP(james): this is never hit!
});
