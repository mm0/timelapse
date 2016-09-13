// author: James Fulop
// date: September 8: 2016
// NodeJs ffmpeg wrapper for turning collections of images to videos

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
// NOTE(james): lets us execute other programs (ffmpeg), must do work synchronously
let execSync = require('child_process').execSync;

// NOTE(james): to concatenate videos, we must create a text list for ffmpeg to read
// we also need this to rename temp files
let fs = require('fs');


// NOTE(james): if main hasn't been set, like I think it would be in AWS, then we are using the offline CLI
const args = process.argv;
if (require.main === module)
{
    offlineCLI();
}

function offlineCLI()
{
    // NOTE(james): args array looks like ['node', 'ffmpegWrapper.js', 'imageDirectory', '3', 'existingVideo']
    if (args[2] && args[3] && args[4])
    {
        FFmpegAppendFrames(args[2], args[3], args[4]);
        addAudio();
    }
    else if (args[2] && args[3])
    {
        FFmpegCreateVideoFromFrames(args[2], args[3], false);
        addAudio();
    }
    else
    {
        console.log("bad wrapper arguments. ffmpegWrapper.js imageDirectory FPS [optional]existingVideo");
        return;
    }


    //
    // Upload finalVideo.mp4 to S3 here
    //
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

function addAudio()
{
    //TODO(james): placeholder
    fs.renameSync("finalVideoNoAudio.mp4", "finalVideo.mp4");
}

/*
    NOTE(james): creates a video from the images in imageDirectory at specified fps,
    if its beingAppended the output video name is "newFramesVideoOutput.mp4", otherwise
    it is "finalVideoNoAudio.mp4"
*/
function FFmpegCreateVideoFromFrames(imageDirectory, fps, beingAppended)
{
    console.log("Creating video from frames...");

    if (fps > 30)
    {
        console.log("fps too high, it must be less than or equal to 30");
    }
    // rename files from timestamp format to numbered order format
    {
        // timestamp format is something like 20160907T065144.044Z.jpg
        var fileNames = fs.readdirSync(imageDirectory);
        if (fileNames.length > 0)
        {
            if (fileNames.length > 999)
            {
                console.log("Too many images in directory! Must be less than 1000");
                return;
            }

            console.log("sorting image files...");
            for (var fileIndex = 0; fileIndex < fileNames.length; fileIndex++)
            {
                var fileName = fileNames[fileIndex];
                var extension = fileName.slice(fileName.lastIndexOf("."));
                if (extension != ".jpg")
                {
                    console.log("File in image directory isn't a jpg");
                    return;
                }
            }

            fileNames.sort();

            for (var fileIndex = 0; fileIndex < fileNames.length; fileIndex++)
            {
                var newName;
                if (fileIndex < 10)
                {
                    newName = "00"+ fileIndex.toString();
                }
                else if (fileIndex < 100)
                {
                    newName = "0"+fileIndex.toString();
                }
                else
                {
                    newName = fileIndex.toString();
                }
                var oldPath = imageDirectory+"/"+fileNames[fileIndex];
                var newPath = imageDirectory+"/"+newName+".jpg";
                fs.renameSync(oldPath, newPath);
            }
        }
    }


    var videoName = (beingAppended) ? "newFramesVideoOutput.mp4" : "finalVideoNoAudio.mp4";

    //NOTE(james): FFMPEG images to video docs https://trac.ffmpeg.org/wiki/Create%20a%20video%20slideshow%20from%20images
    var command = platformFFmpegCallingConvention();
    command += " -y"; //NOTE(james): override existing video if there is one (there shouldn't)
    command += " -framerate " + fps.toString();
    command += " -i " + imageDirectory + "/" + "%03d.jpg";//NOTE(james): this expects an image with a name like 001.jpg

    command += " -c:v libx264 -r 30 -pix_fmt yuv420p " + videoName;

    //NOTE(james): final command should be something like ffmpeg -y -framerate FPS -i IMAGEDIRECTORY/%03d.png -c:v libx264 -r 30 -pix_fmt yuv420p out.mp4
    execSync(command);
    console.log("Created video from frames!");
}

// NOTE(james): Creates a video from images in imageDirectory at specified fps,
// appends that video to the existingVideo
function FFmpegAppendFrames(imageDirectory, fps, existingVideo)
{
    FFmpegCreateVideoFromFrames(imageDirectory, fps, true);
    console.log("Concatenating video...");

    var concatListContent = "";
    concatListContent += "file '"+ existingVideo + "'\r\n"; //NOTE(james): becomes - file '/path/to/file1'
    concatListContent += "file 'newFramesVideoOutput.mp4'\r\n";

    fs.writeFileSync("concatList.txt", concatListContent);

    //NOTE(james): FFmpeg concatenation docs https://trac.ffmpeg.org/wiki/Concatenate
    var command = platformFFmpegCallingConvention();
    command += " -y -f concat";
    command += " -i concatList.txt -c copy finalVideoNoAudio.mp4";

    execSync(command);

    fs.unlink("newFramesVideoOutput.mp4"); //NOTE(james): deleting the temp video
    fs.unlink("concatList.txt"); //NOTE(james): deleting the concatList

    console.log("Concatenated video!");
}

//
// Helpers
//
function platformFFmpegCallingConvention()
{
    if (process.platform == "win32")
    {
        return "ffmpeg";
    }
    else if (process.platform == "linux")
    {
        return "./ffmpeg";
    }
    else
    {
        console.log("Unsupported OS!");
        return "";
    }
}
