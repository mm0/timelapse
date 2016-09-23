resource "aws_s3_bucket" "storage_bucket" {
  bucket = "${var.storage_bucket_name}"

  policy = <<POLICY
{
  "Id": "Hubsy-Public-Access-Policy",
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "s3:GetObject",
      "Effect": "Allow",
      "Resource": [
        "arn:aws:s3:::${var.storage_bucket_name}/*/resized/*",
        "arn:aws:s3:::${var.storage_bucket_name}/*/video.mp4"
      ],
      "Principal": "*"
    }
  ]
}
POLICY

  website {
    index_document = "index.html"
  }
  tags {
    TF = "yes"
  }

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["*"]
    expose_headers = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_object" "default-config" {
  bucket = "${aws_s3_bucket.storage_bucket.bucket}"
  key = "config.json"
  source = "./default-config.json"
  etag = "${md5(file("./default-config.json"))}"
}


resource "aws_lambda_permission" "allow_bucket" {
    statement_id = "AllowExecutionFromS3Bucket"
    action = "lambda:InvokeFunction"
    function_name = "${var.apex_function_upload-handler}"
    principal = "s3.amazonaws.com"
    source_arn = "${aws_s3_bucket.storage_bucket.arn}"
}

resource "aws_s3_bucket_notification" "bucket_notification" {
    bucket = "${aws_s3_bucket.storage_bucket.id}"
    lambda_function {
        lambda_function_arn = "${var.apex_function_upload-handler}"
        events = ["s3:ObjectCreated:*"]
        filter_prefix = "full/"
        filter_suffix = ".jpg"
    }
}
