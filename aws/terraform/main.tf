data "aws_caller_identity" "current" {}

locals {
  account_id          = data.aws_caller_identity.current.account_id
  function_name       = "${var.project_name}-rag"
  embedding_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.embedding_model_id}"
  generation_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.generation_model_id}"

  # Wired in from guardrail.tf when var.enable_guardrail = true.
  guardrail_id      = var.enable_guardrail ? aws_bedrock_guardrail.this[0].guardrail_id : ""
  guardrail_version = var.enable_guardrail ? aws_bedrock_guardrail_version.this[0].version : ""
}

# ---------------------------------------------------------------------------
# Document corpus bucket (source of truth that the Knowledge Base ingests)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "docs" {
  bucket        = "${var.project_name}-docs-${local.account_id}"
  force_destroy = true # so `terraform destroy` doesn't choke on objects
}

# ---------------------------------------------------------------------------
# S3 Vectors store (the cheap, near-zero-idle alternative to OpenSearch)
# ---------------------------------------------------------------------------
resource "aws_s3vectors_vector_bucket" "this" {
  vector_bucket_name = "${var.project_name}-vectors-${local.account_id}"
  force_destroy      = true
}

resource "aws_s3vectors_index" "this" {
  index_name         = "${var.project_name}-index"
  vector_bucket_name = aws_s3vectors_vector_bucket.this.vector_bucket_name
  data_type          = "float32"
  dimension          = var.vector_dimension
  distance_metric    = "cosine"

  # Bedrock writes the chunk text + source metadata into these keys. They must be
  # non-filterable or ingestion fails on the filterable-metadata size limit.
  metadata_configuration {
    non_filterable_metadata_keys = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
  }
}

# ---------------------------------------------------------------------------
# IAM role assumed by the Bedrock Knowledge Base service
# ---------------------------------------------------------------------------
resource "aws_iam_role" "kb" {
  name = "${var.project_name}-kb-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "kb" {
  name = "${var.project_name}-kb-policy"
  role = aws_iam_role.kb.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EmbedDocuments"
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = local.embedding_model_arn
      },
      {
        Sid      = "ReadDocsBucket"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.docs.arn, "${aws_s3_bucket.docs.arn}/*"]
      },
      {
        Sid    = "S3VectorsReadWrite"
        Effect = "Allow"
        Action = [
          "s3vectors:GetIndex",
          "s3vectors:QueryVectors",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:ListVectors",
          "s3vectors:DeleteVectors",
        ]
        Resource = [
          aws_s3vectors_vector_bucket.this.vector_bucket_arn,
          aws_s3vectors_index.this.index_arn,
        ]
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Knowledge Base + S3 data source
# ---------------------------------------------------------------------------
resource "aws_bedrockagent_knowledge_base" "this" {
  name     = "${var.project_name}-kb"
  role_arn = aws_iam_role.kb.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = local.embedding_model_arn
      embedding_model_configuration {
        bedrock_embedding_model_configuration {
          dimensions          = var.vector_dimension
          embedding_data_type = "FLOAT32"
        }
      }
    }
  }

  storage_configuration {
    type = "S3_VECTORS"
    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.this.index_arn
    }
  }

  depends_on = [aws_iam_role_policy.kb]
}

resource "aws_bedrockagent_data_source" "this" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.this.id
  name              = "${var.project_name}-docs"

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn = aws_s3_bucket.docs.arn
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda: bedrock-agent-runtime RetrieveAndGenerate behind a Function URL
# ---------------------------------------------------------------------------
data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../lambda/handler.py"
  output_path = "${path.module}/build/lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${local.account_id}:*"
      },
      {
        Sid      = "RagQuery"
        Effect   = "Allow"
        Action   = ["bedrock:RetrieveAndGenerate", "bedrock:Retrieve"]
        Resource = aws_bedrockagent_knowledge_base.this.arn
      },
      {
        Sid      = "InvokeGenerationModel"
        Effect   = "Allow"
        Action   = "bedrock:InvokeModel"
        Resource = local.generation_model_arn
      },
      ], var.enable_guardrail ? [{
        Sid      = "ApplyGuardrail"
        Effect   = "Allow"
        Action   = "bedrock:ApplyGuardrail"
        Resource = aws_bedrock_guardrail.this[0].guardrail_arn
    }] : [])
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 7 # keep CloudWatch storage in free tier
}

resource "aws_lambda_function" "this" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      KNOWLEDGE_BASE_ID = aws_bedrockagent_knowledge_base.this.id
      MODEL_ARN         = local.generation_model_arn
      MAX_TOKENS        = tostring(var.max_tokens)
      GUARDRAIL_ID      = local.guardrail_id
      GUARDRAIL_VERSION = local.guardrail_version
      SHARED_SECRET     = var.shared_secret
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_lambda_function_url" "this" {
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [var.allowed_origin] # TODO: lock to your GitHub Pages origin
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}
