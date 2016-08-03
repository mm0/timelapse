# Hubsy Timelapse

Use AWS infrastructure for timelapse videos and presentations.

## Overview

1. Images are submitted to an S3 bucket.
2. A Lambda function is triggered on new image upload
2.1. The image is registered in a DB
2.2. The image is resized
2.3. The image is added to the timelapse video
3. A rules-based workflow is triggered for further processing
4. A lambda funtion can be called via HTTP to retrive a list of file names for a slideshow given a date/time range

## Implementation details

### S3 storage

Cameras upload the original full size images to an S3 bucket. Every camera has its own bucket. The path inside the bucket (object prefix) is configurable.

* **bucket name**: configurable
* **file_names**: it can be anything, as long as it's unique, e.g. _d4b000dc-5920-11e6-8b77-86f30ca893d3.jpg_
* **object properties**: mimetype=image/jpg, http caching=forever

### DB

Every uploaded image is registed in the DB. Every bucket has its own DB with the same name.

* **Primary key**: ???
* **Fields**: file name, exif, size, width, height, ...

DB search use cases: 
* get image details by its file name
* get image details by its timestamp
* get list of images within a time range

### Image resizing

Images are resized to multiple smaller sizes as per this section of the config file:

    {
      "resize": [
        {"folder": "fhd", "width": 1920, "height": 1080}
        {"folder": "hd", "width": 1080, "height": 720}
        {"folder": "small", "width": 500, "height": 500}
      ]
    }

### Video

Every new image is added to the end of the timelapse video. Frame duration, video size and other parameters are specified in the config file.

### Getting a list of images for a slideshow

An HTTP request can be made to a lambda function to get a list of files for a date/time range. The HTTP REST API is configured via _Amazon API Gateway_.

**Parameters**: `dateBefore`, `dateAfter`, `count`.

