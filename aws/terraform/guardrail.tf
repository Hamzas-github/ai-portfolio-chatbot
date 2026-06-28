# ---------------------------------------------------------------------------
# STRETCH (disabled by default): Bedrock Guardrail for responsible-AI +
# prompt-injection protection. Enable with `-var enable_guardrail=true`.
# When on, main.tf wires guardrail_id/version into the Lambda env and the KB
# generation call applies it.
#
# NOTE: confirm these argument names against your provider version
#       (terraform providers schema) — the guardrail schema evolves.
# ---------------------------------------------------------------------------
resource "aws_bedrock_guardrail" "this" {
  count                     = var.enable_guardrail ? 1 : 0
  name                      = "${var.project_name}-guardrail"
  blocked_input_messaging   = "I can't help with that."
  blocked_outputs_messaging = "I can't help with that."

  content_policy_config {
    # PROMPT_ATTACK guards against prompt injection / jailbreak attempts.
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE" # PROMPT_ATTACK only supports input filtering
    }
    filters_config {
      type            = "HATE"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }
    filters_config {
      type            = "INSULTS"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "SEXUAL"
      input_strength  = "HIGH"
      output_strength = "HIGH"
    }
    filters_config {
      type            = "VIOLENCE"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
  }
}

resource "aws_bedrock_guardrail_version" "this" {
  count         = var.enable_guardrail ? 1 : 0
  guardrail_arn = aws_bedrock_guardrail.this[0].guardrail_arn
  description   = "v1"
}
