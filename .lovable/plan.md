

# Update Falcon HF Endpoint URL

Update the `FALCON_HF_ENDPOINT_URL` secret to the new Hugging Face endpoint:

```
https://efsmvsds6b9u2s0q.us-east-1.aws.endpoints.huggingface.cloud
```

Single step: use the secrets tool to update the existing `FALCON_HF_ENDPOINT_URL` value. No code changes needed since the edge function already reads this from the environment.

