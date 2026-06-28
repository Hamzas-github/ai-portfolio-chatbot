terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # 6.27.0 is the first release with storage_configuration.s3_vectors_configuration
      # for aws_bedrockagent_knowledge_base. The aws_s3vectors_* resources landed in 6.24.
      version = ">= 6.27.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
  }
}

provider "aws" {
  region = var.region
}
