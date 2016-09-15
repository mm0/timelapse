# User Variables
variable "storage_bucket_name" {}

# Will be provided by Apex
variable "aws_region" {}
variable "apex_function_role" {}
variable "apex_function_upload-handler" {}

provider "aws" {}
