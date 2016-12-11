# User Variables
variable "storage_bucket_name" {
}

# Will be provided by Apex
variable "aws_region" {}
variable "apex_function_role" {}
variable "apex_function_upload-handler" {}
variable "apex_function_delete-handler" {}
variable "apex_function_video-handler" {}

##Setup needed variables
variable "aws_key_name" {
  "default" = "timelapse"
}
variable "my_ip_address" {

}
variable "instance_type" {
  default = "t2.micro"
}

variable "aws_availability_zone" {
  description = "AZ within region"
  default = {
    us-west-1 = "us-west-1a"
    us-east-1 = "us-east-1a"
  }
}
variable "amis" {
  description = "AMIs by region"
  default = {
    us-west-1 = "ami-93d798f3"
    # ubuntu 14.04 LTS (hvm)
    us-east-1 = "ami-a93631be"
    # ubuntu 14.04 LTS (hvm:ebs)
  }
}

variable "vpc_cidr" {
  description = "CIDR for the whole VPC"
  default = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR for the Public Subnet"
  default = "10.0.1.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR for the Private Subnet"
  default = "10.0.2.0/24"
}

variable "aws_ec2_instance_profile_name" {
  default = "terraform_ec2_iam_instance_profile"
}

provider "aws" {
  profile = "timelapse"
}
