Hubsy Timelapse uses AWS infrastructure to create timelapse videos and slideshows from images taken by [Hubsy Cameras](http://hubsy.io).

# Overview

This set of tools was developed for [Hubsy Cameras](http://hubsy.io). They are small autonomous cams with high resolution sensors, WiFi and cellular connectivity and either battery or solar power supply.

1. Put your hubsy up and point it in the direction of the action
2. Your hubsy will start uploading images to an S3 bucket.
3. A Lambda function is triggered on new image upload
3.a. The image is processed (cropped, resized, exif cleaned up, etc)
3.b. The image is added to the timelapse video and uploaded to YouTube, if want to make it public
4. A rules-based workflow is triggered for further processing
5. A lambda function can be called via HTTP to retrieve a list of file names for a slideshow given a date/time range
6. A JavaScript slideshow can be embedded into your website to show the last N images

# Image processing with a λ-function

## Set up

#### 1. Install [Terraform](https://www.terraform.io/intro/getting-started/install.html).
It is needed to create policies, EC2 instances and other AWS infrastructure.

#### 2. Install [Apex](http://apex.run).
This is the overall 

  On macOS, Linux, or OpenBSD run the following:

  ```bash
  curl https://raw.githubusercontent.com/apex/apex/master/install.sh | sh
  ```

#### 3. Install Ansible 2.*

```bash
sudo pip --upgrade install pip
pip install ansible==2.1.1.0
```
     
#### 3b. install ansible dependencies

```bash
ansible-galaxy install -r Ansible/requirements.yml -p Ansible/roles
```

#### 4. Install dependencies:
```bash
sudo apt-get update
sudo apt-get install nodejs
npm install
```

#### 4.1 Compile Lambda functions on the control box

Make sure the code is already on the control box:

```bash
mkdir ~/timelapse
cd ~/timelapse
git clone https://github.com/hubsy-io/timelapse.git
```
or
```bash
cd ~/timelapse
git pull
```

Compile the code with webpack for every Lambda function:

```bash
#!/usr/bin/env bash
cd functions/upload-handler/
../../node_modules/.bin/webpack --config ../../webpack.config.js
cd ../../functions/delete-handler/
../../node_modules/.bin/webpack --config ../../webpack.config.js
cd ../../functions/video-handler/
../../node_modules/.bin/webpack --config ../../webpack.config.js
```

Compilation of the node.js function on the ec2 instance should be done with `./node_modules/.bin/webpack --config ./webpack.ec2.config.js` from the app root directory.

#### 5. Set your AWS configuration and region. using `aws configure` cli command or:
```bash
export AWS_ACCESS_KEY_ID=***
export AWS_SECRET_ACCESS_KEY=***
export AWS_REGION=us-east-1
```

#### 6. Set the source S3 bucket name as env variable:
```bash
export TF_VAR_storage_bucket_name=my-hubsy-image-bucket-name
```

#### 7. Deploy functions and apply your infrastructure:

Replace my_ip_address with the IP address of the control box. This is used to open up an SSH port for provisioning with Ansible.

Replace ssh_public_key_file with the public key you want to use for the keypair to access via SSH.

Enter the project name during the init stage as `Timelapse` because this name is hardcoded in some functions.

```bash
apex init
apex deploy
apex infra apply --var my_ip_address=9.9.9.9 --var ssh_public_key_file=~/.ssh/id_rsa.pub
```

`apex infra apply` will add the IP address of the new instance it created to an inventory file.

#### 8.  Provision the server using ansible:

```bash
cd Ansible
ansible-playbook -e 'host_key_checking=False' provision_server.yml
ansible-playbook provision_server.yml -i hosts/ -e 'target=Prod' --user=ubuntu --private-key ~/.ssh/id_rsa
```

#### 9. Start uploading images to `[my-hubsy-image-bucket-name]/full/[cam-name]/`

### Local development

1. Run `vagrant up`

2. Log into local box using `vagrant ssh`

3. run `aws configure` and enter AWS credentials when prompted

4. `cd /vagrant/`

5. build with `./node_modules/.bin/webpack --config webpack.ec2.config.js` (win: `node_modules\.bin\webpack.cmd --config webpack.ec2.config.js`)

6. run with `node lib/index.js`


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

### Image resizing

Images are resized to multiple smaller sizes as per this section of the config file:

    {
      "exif-retain": ["Orientation", "DateTime", "DateTimeOriginal"],
      "resize": [
        {"folder": "resized/fhd", "width": 1920, "height": 1080, "quality": 50}
        {"folder": "resized/hd", "width": 1080, "height": 720, "quality": 50}
        {"folder": "resized/small", "width": 500, "height": 500, "quality": 50}
      ],
      "rotate": {"degrees": 45, color: "green"},
      "crop": {"top": 100, "left": 100,	"width": 300, "height": 300}
    }

* **exif-retain**: list of EXIF tags to be copied to resized images.
* **folder**: folder name for the resized image to be put in, relative to the camera root. It's just an object prefix in the context of S3.
* **width**, **height**: the maximum size in pixels for the image. It may not be proportional to the image which has to fit into this bounding box without cropping.
* **compression** - JPEG compression / quality level, 1 - 100, where 1 is the lowest and 100 is uncompressed.
* **rotate** - rotates the canvas to the nearest quadrant fills it with *color* ([Supported Colors](http://www.imagemagick.org/script/color.php)) and rotate the image inside it
* **crop** - describes the box that has to be cropped from the original image before resizing.

When a new file is placed into the bucket the λ-function checks if it's a valid jpeg file, parse the name, extract paths, read the config files, crop, resize and save the results. Images are rotated to the set orientation and the exif orientation tag is removed for compatibility.

And also when a file is removed form the bucket another λ-function checks and removes all the resized versions as well.

Please note that by default the upload-handler λ-function is configured with 1024MB RAM, but that might not be sufficient if you configure your cam to do multiple resizing, so you can easily increase it by editing https://github.com/hubsy-io/timelapse/blob/master/functions/upload-handler/function.json#L4 and redeploying the function.

# Timelapse video

A timelapse video can be created on request by calling `timelapse_video-encoder` λ-function that either appends new images to an existing video or creates a new one. Video parameters are placed in the config file for the bucket / camera.

  ```
  {
    "width": 1920,
    "height": 1080,
    "source": "resized/fhd",
    "fps": 30
  }
  ```

* **width**, **height**: resolution of the output video. If this is omitted and there is not existing video yet, the resolution of the output video will be the size of the first image provided. Otherwise the resolution of the existing video will prevail. If the resolution provided is different from the resolution of either of the inputs, the inputs will be uniformly scaled to meet the provided resolution. If there is an aspect ratio discrepancy they will be uniformly scaled until their the width or height is matched, then other axis will be letterboxed.
* **source**: folder name to find images, relative to the bucket root. It's just an object prefix in the context of S3.
* **fps**: this is how fast the images should change in the video. The video will play at a a steady 30 FPS, so this only affects how many frames the images are duplicated for. Must be <= 30.

In order to run the function you should pass an event like this to *video-encoder* λ-function:

    {
      "bucket": "BUCKET-NAME",
      "cam": "CAM-NAME"
    }

You can also run it using apex:

```bash
echo '{"bucket": "BUCKET-NAME", "cam", "CAM-NAME"}' | apex invoke video-encoder
```

or by clicking test on AWS Lambda Management Console and providing the same event.

To make things automated you can use AWS CloudWatch Scheduled events to run video-encoder on schedule for each cam. To do so:

1. Go to AWS > CloudWatch > Events > Create Rule
2. Choose *Scedule* as event source
3. Click add target and select *video-encoder* Lambda function
4. Configure event to constant (JSON text) and provide the above JSON event

# Slideshow

You can find a sample slideshow page code on https://github.com/hubsy-io/timelapse/blob/gh-pages/index.html or view a demo at https://hubsy-io.github.io/timelapse/.

We used [Swiper](http://idangero.us/swiper) to create a touch friendly slideshow with lazy image loading.

There are a few configurable parameters for this script, but the only required parameter you have to specify is the source of your image file. They are listed in multiple index files. Look inside `resized` directory for `idx` subfolder and choose the suitable index file, e.g. `https://s3.amazonaws.com/[your bucket name]/[your cam name]/resized/sd/idx/last100.txt`

Insert this HTML placeholder wherever you want to see the slideshow:
```html
<div class="swiper-container">
    <div class="swiper-wrapper"></div>
    <!-- Pagination (optional) -->
    <div class="swiper-pagination swiper-pagination-white"></div>
    <!-- Navigation (optional) -->
    <div class="swiper-button-next swiper-button-white"></div>
    <div class="swiper-button-prev swiper-button-white"></div>
</div>
```

Insert these scripts anywhere of the page to initialize the slideshow. Make sure you replaced the URL of index file with the one pointing at your images.
```html
<script src="https://code.jquery.com/jquery-1.12.4.min.js" integrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ=" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/js/swiper.jquery.min.js"></script>
<script>
  // Loading Swiper stylesheet
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/css/swiper.min.css';
  document.head.appendChild(link);
</script>
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
You can find more configuration options in [Swiper Docs](http://idangero.us/swiper/api/).

You can also insert CSS link tag in your html header manualy instead of using stylesheet loader script:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/css/swiper.min.css">
```

Make sure to enable [CORS on your AWS S3 bucket](http://docs.aws.amazon.com/AmazonS3/latest/dev/cors.html). You can use this sample configuration that allows all origins to access your resources:

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

#Resources

This section is a guide to how much resources you may need to allocate depending on the amounts of data and usage scenarios.

###Images

* S5, full reso, 5312x2988px, 5-7MB
* resized to 720x640px, 50kb | 1280x720px, 80kb | 1920x1080px, 200mb
* time to process a full reso image into the 3 resized images and update the indexes: 24s (an awful lot!)

###Video

* xxx full reso S5 images produce yyymb of mp4 video in zzz minutes ([insert lambda config here])
