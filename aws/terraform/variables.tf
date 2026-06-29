variable "region" {
  description = "AWS region. us-east-1 has the widest Bedrock + S3 Vectors availability."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix for all resource names."
  type        = string
  default     = "ask-hamza"
}

variable "embedding_model_id" {
  description = "Bedrock embedding model. Titan Text Embeddings v2, 1024-dim."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "generation_model_id" {
  description = "Bedrock generation model. Claude Haiku 4.5 is the cheapest ACTIVE Claude Haiku (Claude 3 Haiku is now Legacy/blocked). It's inference-profile-only; main.tf builds the us.* profile ARN from this id."
  type        = string
  default     = "anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "vector_dimension" {
  description = "Must match the embedding model output. Titan v2 = 1024."
  type        = number
  default     = 1024
}

variable "max_tokens" {
  description = "Cap on generated answer length to keep token cost tiny."
  type        = number
  default     = 400
}

variable "allowed_origin" {
  # TODO: set this to your exact GitHub Pages origin, e.g. "https://hamza.github.io"
  # Leave as "*" only while testing. A single string; Function URL CORS takes a list.
  description = "CORS origin allowed to call the Function URL."
  type        = string
  default     = "*"
}

variable "shared_secret" {
  description = "Optional secret the caller (your Cloudflare Worker) must send as the x-ask-hamza-key header. Leave empty to disable. Set the same value as the Worker's ASK_HAMZA_KEY."
  type        = string
  default     = ""
  sensitive   = true
}

variable "enable_guardrail" {
  description = "Stretch: enable a Bedrock Guardrail (see guardrail.tf). Off by default."
  type        = bool
  default     = false
}
