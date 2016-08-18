'use strict';
let im = require('imagemagick');
let fs = require('fs');


const postProcessResource = (resource, fn) => {
    let ret = null;
    if (resource) {
        if (fn) {
            ret = fn(resource);
        }
        try {
            fs.unlinkSync(resource);
        } catch (err) {
            // Ignore
        }
    }
    return ret;
};


const identify = (event, callback) => {
    if (!event.base64Image) {
        const msg = 'Invalid identify request: no "base64Image" field supplied';
        console.log(msg);
        callback(msg);
        return;
    }
    const tmpFile = `/tmp/inputFile.${(event.inputExtension || 'png')}`;
    let buffer = new Buffer(event.base64Image, 'base64');
    fs.writeFileSync(tmpFile, buffer);
    const args = event.customArgs ? event.customArgs.concat([tmpFile]) : tmpFile;
    im.identify(args, (err, output) => {
        fs.unlinkSync(tmpFile);
        if (err) {
            console.log('Identify operation failed:', err);
            callback(err);
        } else {
            console.log('Identify operation completed successfully');
            callback(null, output);
        }
    });
};

const resize = (event, callback) => {
    if (!event.base64Image) {
        const msg = 'Invalid resize request: no "base64Image" field supplied';
        console.log(msg);
        callback(msg);
        return;
    }
    // If neither height nor width was provided, turn this into a thumbnailing request
    if (!event.height && !event.width) {
        event.width = 100;
    }
    const resizedFile = `/tmp/resized.${(event.outputExtension || 'png')}`;
    let buffer = new Buffer(event.base64Image, 'base64');
    delete event.base64Image;
    delete event.outputExtension;
    event.srcData = buffer;
    event.dstPath = resizedFile;
    try {
        im.resize(event, (err, stdout, stderr) => {
            if (err) {
                throw err;
            } else {
                console.log('Resize operation completed successfully');
                callback(null, postProcessResource(resizedFile, (file) => new Buffer(fs.readFileSync(file)).toString('base64')));
            }
        });
    } catch (err) {
        console.log('Resize operation failed:', err);
        callback(err);
    }
};

const convert = (event, callback) => {
    event.customArgs = event.customArgs || [];
    let inputFile = null;
    let outputFile = null;
    if (event.base64Image) {
        inputFile = `/tmp/inputFile.${(event.inputExtension || 'png')}`;
        let buffer = new Buffer(event.base64Image, 'base64');
        fs.writeFileSync(inputFile, buffer);
        event.customArgs.unshift(inputFile);
    }
    if (event.outputExtension) {
        outputFile = `/tmp/outputFile.${event.outputExtension}`;
        event.customArgs.push(outputFile);
    }
    im.convert(event.customArgs, (err, output) => {
        if (err) {
            console.log('Convert operation failed:', err);
            callback(err);
        } else {
            console.log('Convert operation completed successfully');
            postProcessResource(inputFile);
            if (outputFile) {
                callback(null, postProcessResource(outputFile, (file) => new Buffer(fs.readFileSync(file)).toString('base64')));
            } else {
                // Return the command line output as a debugging aid
                callback(null, output);
            }
        }
    });
};


exports.handler = (event, context, callback) => {
    const operation = event.operation;
    delete event.operation;
    if (operation) {
        console.log(`Operation ${operation} 'requested`);
    }

    switch (operation) {
        case 'ping':
            callback(null, 'pong');
            break;
        case 'getDimensions':
            event.customArgs = ['-format', '%wx%h'];
            /* falls through */
        case 'identify':
            identify(event, callback);
            break;
        case 'thumbnail':  // Synonym for resize
        case 'resize':
            resize(event, callback);
            break;
        case 'getSample':
            event.customArgs = ['rose:'];
            event.outputExtension = event.outputExtension || 'png';
            /* falls through */
        case 'convert':
            convert(event, callback);
            break;
        default:
            callback(new Error(`Unrecognized operation "${operation}"`));
    }
};
