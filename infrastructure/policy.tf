resource "aws_iam_policy" "lambda-policy" {
    name = "timelapse_lambda_function_policy"
    description = "Policy to allow lamda access to s3"
    policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
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
        "s3:PutObject"
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
