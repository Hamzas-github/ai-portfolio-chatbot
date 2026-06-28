output "function_url" {
  description = "POST {\"question\": \"...\"} here from the widget."
  value       = aws_lambda_function_url.this.function_url
}

output "knowledge_base_id" {
  value = aws_bedrockagent_knowledge_base.this.id
}

output "data_source_id" {
  value = aws_bedrockagent_data_source.this.data_source_id
}

output "docs_bucket" {
  value = aws_s3_bucket.docs.bucket
}

output "vector_index_arn" {
  value = aws_s3vectors_index.this.index_arn
}

output "ingestion_command" {
  description = "Run after `aws s3 sync ../docs s3://<docs_bucket>` to (re)index."
  value       = "aws bedrock-agent start-ingestion-job --region ${var.region} --knowledge-base-id ${aws_bedrockagent_knowledge_base.this.id} --data-source-id ${aws_bedrockagent_data_source.this.data_source_id}"
}
