/*
  Web Servers
*/
resource "aws_security_group" "timelapse" {
    name = "vpc_timelapse"
    description = "Allow incoming HTTP connections."

    ingress {
        from_port = 80
        to_port = 80
        protocol = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
    }
    ingress {
        from_port = 443
        to_port = 443
        protocol = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
    }
    ingress {
        from_port = -1
        to_port = -1
        protocol = "icmp"
        cidr_blocks = ["0.0.0.0/0"]
    }
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
