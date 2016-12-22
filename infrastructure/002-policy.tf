resource "aws_iam_policy" "lambda-policy" {
  name = "timelapse_lambda_function_policy_${aws_s3_bucket.storage_bucket.bucket}"
  description = "Policy to allow lamda and ec2 to access s3"
  policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect":"Allow",
      "Action":"lambda:InvokeFunction",
      "Resource":"${var.apex_function_video-handler}*"
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
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*"
      ],
      "Resource": "*"
        },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Start*",
        "ec2:Stop*",
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
        "Condition": {
        "StringEquals": {
          "ec2:InstanceProfile":
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/${var.aws_ec2_instance_profile_name}"
        }
      }
    }
  ]
}
POLICY

}

resource "aws_iam_role_policy_attachment" "lambda-policy-attach-2" {
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

resource "aws_iam_instance_profile" "terraform_ec2_iam_instance_profile" {
  name = "terraform_ec2_iam_instance_profile"
  roles = [
    "${aws_iam_role.terraform_ec2_role.name}"]
}

resource "aws_iam_role_policy_attachment" "lambda-policy-attach-ec2" {
  role = "${aws_iam_role.terraform_ec2_role.name}"
  policy_arn = "${aws_iam_policy.lambda-policy.arn}"
}

resource "aws_iam_role" "terraform_ec2_role" {
  name = "terraform_ec2_role"
  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    }
  ]
}
EOF
}

