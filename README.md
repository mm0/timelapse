# Hubsy Timelapse

Use AWS infrastructure for timelapse videos and presentations.

## Overview

1. Images are submitted to an S3 bucket.
2. A Lambda function is triggered on new image upload
2.2. The image is processed (cropped, resized, exif cleaned up, etc)
2.3. The image is added to the timelapse video
3. A rules-based workflow is triggered for further processing
4. A lambda funtion can be called via HTTP to retrive a list of file names for a slideshow given a date/time range

## Setup

```bash
npm install
```
Set your AWS configuration in `.env` file.

To test run locally:
```bash
npm start
```

To deploy on AWS:
```bash
npm run deploy
```


## Implementation details

### S3 storage

Cameras upload the original full size images to an S3 bucket. Every camera has its own path within a bucket. The path inside the bucket (object prefix) is configurable.

```
    -bucket
        config.json
        -full
          -cam1
          -cam2
          ...
        -cam1
            config.json
            index.txt
            -exif
            -resized
                -[size name 1]
                    -idx
                        last.txt
                        last100.txt
                        today.txt
                        24hr.txt
                        7days.txt
                        30days.txt
                -[size name 2]
                    -idx
                -[size name 3]
        -cam2
        ...
```

* **bucket name**: can be any name. A λ-function assigned to the bucket will extract the bucket name and the cam prefix from the object name it was given.
* **config.json**: a config file, which can be nested. The deeper level config file overwrites the higher level one.
* **index.txt**: a text file used internally for updating **idx** folder of each size, containing the index of the last 5,000 uploaded images. It will be created automatically by the λ-function.
* **file names**: uploaded file names must follow ISO 8601 + the file type in this format (YYYYMMDDThhmmss.ssss.jpg, e.g. 20160815T170001.050.jpg). The date/time is recorded by the camera at the moment of the image capture. It may be different from the exif data.
* **object properties**: mimetype=image/jpg, http caching=forever
* **full**: the folder for original files. This is where the cameras upload them in the first place. This folder is taken out to the top level to avoid firing the λ-function when resized images are added.
* **idx**: a folder with indexes maintained by the λ-function as simple list of URLs, one per line. Set http caching to expire immediately.
* **exif**: a folder with with exif data files extracted from the originals. The file names must match those of the original file, except the extension (.txt) and the mime type is text/text, http caching=forever
* **resized**: a folder with resized images with the same file names as the original. The images are grouped in subfolders as per the config file. Set http caching=forever

The camera app knows the bucket name, AWS credentials and its name. It will construct the object name in the format: `[bucketname]/full/[cameraname]/[filename].jpg` and send it to S3. The λ-function will be triggered by the upload and will process the file.

Theoretically, there is no need to pre-create the camera folder if the AWS credentials allow for bucket-wide uploads.

The λ-function creates the folders it needs on the fly. There is no need to pre-create them, unless it is required for access control purposes.

#### Bucket policies

The goal is to grant public access to all objects in `resized` folder.

```
{
	"Id": "Hubsy-Public-Access-Policy",
	"Version": "2012-10-17",
	"Statement": [
		{
			"Action": "s3:GetObject",
			"Effect": "Allow",
			"Resource": "arn:aws:s3:::BUCKET-NAME/*/resized/*",
			"Principal": "*"
		}
	]
}
```

The λ-function has its own set of policies. It should be able to read the entire contents of the bucket, but write only into `resized` folder. This policy has to be set in IAM and attached to the role used for the function.

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::BUCKET-NAME"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::BUCKET-NAME/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject"
            ],
            "Resource": [
                "arn:aws:s3:::BUCKET-NAME/*resized*",
                "arn:aws:s3:::BUCKET-NAME/*/exif/*",
                "arn:aws:s3:::BUCKET-NAME/*index.txt"
            ]
        }
    ]
}
```

### Image resizing

Images are resized to multiple smaller sizes as per this section of the config file:

    {
      "exif-retain": ["Orientation", "DateTime", "DateTimeOriginal"],
      "resize": [
        {"folder": "resized/fhd", "width": 1920, "height": 1080, "compression": 50}
        {"folder": "resized/hd", "width": 1080, "height": 720, "compression": 50}
        {"folder": "resized/small", "width": 500, "height": 500, "compression": 50}
      ],
      "crop": {"top": 100, "left": 100,	"width": 300, "height": 300}
    }

* **exif-retain**: list of EXIF tags to be copied to resized images.
* **folder**: folder name for the resized image to be put in, relative to the camera root. It's just an object prefix in the context of S3.
* **width**, **height**: the maximum size in pixels for the image. It may not be proportional to the image which has to fit into this bounding box without cropping.
* **compression** - JPEG compression / quality level, 1 - 100, where 1 is the lowest and 100 is uncompressed.
* **crop** - describes the box that has to be cropped from the original image before resizing.

When a new file is placed into the bucket the λ-function should check if it's a valid jpeg file, parse the name, extract paths, read the config files, crop, resize and save the results.

### Video

Every new image is added to the end of the timelapse video. Frame duration, video size and other parameters are specified in the config file.

### Getting a list of images for a slideshow

The most commonly requested image sets are stored in `[cam-name]/idx` folder as absolute image URLs, one per line.

An HTTP request can be made to a lambda function to get a list of files for a date/time range. The HTTP REST API is configured via _Amazon API Gateway_.

**Parameters**: `dateBefore`, `dateAfter`, `count`.


### Sample Slideshow
You can find example slideshow page code on https://github.com/hubsy-io/timelapse/blob/gh-pages/index.html it's accessible on https://hubsy-io.github.io/timelapse/.

It's using [Swiper](http://idangero.us/swiper) to create a touch friendly slideshow with lazy image loading.

All you have to do is to include Swiper CSS, Swiper JS file and jQuery on your page:
```html
<!-- Link Swiper's CSS -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/css/swiper.min.css">

<!-- jQuery -->
<script src="https://code.jquery.com/jquery-1.12.4.min.js" integrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ=" crossorigin="anonymous"></script>
<!-- Swiper JS -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/js/swiper.jquery.min.js"></script>
```
Add this placeholder wherever you want to see the slideshow:
```html
<!-- Swiper -->
<div class="swiper-container">
    <!-- Slides Placeholder -->
    <div class="swiper-wrapper"></div>

    <!-- Add Pagination (optional) -->
    <div class="swiper-pagination swiper-pagination-white"></div>

    <!-- Navigation (optional) -->
    <div class="swiper-button-next swiper-button-white"></div>
    <div class="swiper-button-prev swiper-button-white"></div>
</div>
```
And Initialize it using:
```html
<script>
  $(function() {
    // Loading arbitrary index file
    $.get('https://s3.amazonaws.com/hubsy-upwork/cam1/resized/sd/idx/last100.txt', function(data) {
      // Populating slides
      $('.swiper-wrapper').html(data.split('\n').map(function(url){
        // Extracting ISO date from URL
        var iso = url.match(/([^\/]+)(?=\.\w+$)/)[0];
        // Converting ISO date
        var title = new Date(iso.slice(0,4) + '-' + iso.slice(4,6) + '-' + iso.slice(6,11) + ':' + iso.slice(11,13) + ':' + iso.slice(13));
        return '<div class="swiper-slide"><img data-src="' + url +  '" class="swiper-lazy"><div class="title">' + title + '</div><div class="swiper-lazy-preloader swiper-lazy-preloader-white"></div></div>'
      }).join(''));

      // Initializing swiper
      var swiper = new Swiper('.swiper-container', {
        nextButton: '.swiper-button-next',
        prevButton: '.swiper-button-prev',
        pagination: '.swiper-pagination',
        paginationClickable: true,
        // Disable preloading of all images
        preloadImages: false,
        // Enable lazy loading
        lazyLoading: true,
        effect: 'fade'
      });
    });
  });
</script>
```
You can find more options here at [Swiper Docs](http://idangero.us/swiper/api/).

Make sure to enable [CORS on your AWS S3 bucket](http://docs.aws.amazon.com/AmazonS3/latest/dev/cors.html). You can use this quick configuration that allows all origins to access your resources:

```xml
<CORSConfiguration>
 <CORSRule>
   <AllowedOrigin>*</AllowedOrigin>
   <AllowedMethod>GET</AllowedMethod>
   <AllowedHeader>*</AllowedHeader>
 </CORSRule>
</CORSConfiguration>
```
*AllowedOrigin* tag can have `*` if you want any website to embed your slideshow or a specific domain name, including http-part, e.g. `http://www.example2.com` to limit it to your website only.
