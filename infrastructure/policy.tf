resource "aws_iam_policy" "lambda-policy" {
    name = "timelapse_lambda_function_policy_${aws_s3_bucket.storage_bucket.bucket}"
    description = "Policy to allow lamda to access s3"
    policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect":"Allow",
      "Action":"lambda:InvokeFunction",
      "Resource":"${var.apex_function_video-encoder}*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*resized*",
        "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*/exif/*",
        "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*index.txt",
        "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*last-video-index.txt",
        "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/*video.mp4"
      ]
    }
  ]
}
POLICY

}

resource "aws_iam_role_policy_attachment" "lambda-policy-attach" {
  role = "${element(split("/", "${var.apex_function_role}"),1)}"
  policy_arn = "${aws_iam_policy.lambda-policy.arn}"
}

resource "aws_iam_policy" "camera-policy" {
    name = "timelapse_camera_policy_${aws_s3_bucket.storage_bucket.bucket}"
    description = "Policy to allow cameras to access s3"
    policy = <<POLICY
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:AbortMultipartUpload",
                "s3:GetAccelerateConfiguration",
                "s3:PutObject"
            ],
            "Resource": [
                "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/full/*",
                "arn:aws:s3:::${aws_s3_bucket.storage_bucket.bucket}/log/*"
            ]
        }
    ]
}
POLICY

}
