/*
  Web Servers
*/
resource "aws_security_group" "timelapse" {
    name = "vpc_timelapse"
    description = "Allow incoming HTTP connections."


    ingress {
        from_port = 22
        to_port = 22
        protocol = "tcp"
        cidr_blocks = ["${var.my_ip_address}/32"]
    }

    egress {
        from_port = 0
        to_port = 0
        protocol = "-1"
        cidr_blocks = ["0.0.0.0/0"]
    }

    vpc_id = "${aws_vpc.default.id}"

    tags {
        Name = "Timelapse_SG"
    }
}
resource "aws_key_pair" "timelapse" {
    key_name = "timelapse"
    public_key = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDvfpIR5lQsOljdc72D2lE4nnPyRCA3HVcbI5rNUWJ6h5dDwtyJNGRKZWEsxxoz3V76m8J/M4RKdsFD2RO0ofOIhJ3WPgnx2YaeDcCUNknNXkCDW8JCnHFOdBcDykmr94/0BwUk8IVA+SSKoOMEvC9SW5ivpBItMga4NmGpggT4L4gfsh7WTRnPjJUPpbaDULpaBkLKhitnXlcXnx0PSEyAbM9vZonRGbcupomR41pRUGLZCDqwEqQri662+PH2JyriY9zWXINgR8DDvdzBtGPq30QITAJEsx8/78HvdJLEQ6p5tl03/Qt9S2Y/GHogwEuQB2u4ubQrAblkyai2o36B matt@mbp.local"
}

resource "aws_instance" "Timelapse" {
    ami = "${lookup(var.amis, var.aws_region)}"
    availability_zone = "${lookup(var.aws_availability_zone,var.aws_region)}"
    instance_type = "${var.instance_type}"
    key_name = "${var.aws_key_name}"
    vpc_security_group_ids = ["${aws_security_group.timelapse.id}"]
    subnet_id = "${aws_subnet.public_subnet.id}"
    associate_public_ip_address = true
    source_dest_check = false
    iam_instance_profile = "${var.aws_ec2_instance_profile_name}"

    tags {
        Name = "Timelapse"
    }

}

resource "aws_eip" "timelapse_server" {
    instance = "${aws_instance.Timelapse.id}"
    vpc = true
    provisioner "local-exec" {
        command = "echo \"[Prod]\n$(aws_eip.timelapse_server)\n\" >> ../Ansible/hosts/aws"
    }
}
resource "aws_iam_role" "lambda-ec2-role" {
  name = "lambda-ec2-role"
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

# create policy for lambda to start stop instance
resource "aws_iam_policy" "lambda-ec2-policy" {
    name = "timelapse_lambda_function_policy_ec2"
    description = "Policy to allow lamda to start-stop ec2 isntance"
    policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
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
        "ec2:Start*",
        "ec2:Stop*"
      ],
      "Resource": "arn:aws:${var.aws_region}::instance/${aws_instance.Timelapse.id}"
    }
  ]
}
POLICY

}

resource "aws_iam_role_policy_attachment" "lambda-policy-attach" {
  role = "${aws_iam_role.lambda-ec2-role.name}"
  policy_arn = "${aws_iam_policy.lambda-ec2-policy.arn}"
}

