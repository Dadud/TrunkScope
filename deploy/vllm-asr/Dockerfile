FROM vllm/vllm-openai:latest

# The OpenAI server image omits the optional audio decoders required by
# /v1/audio/transcriptions. Install the extras for its already-pinned vLLM
# version so the layer remains compatible when the base image changes.
RUN VLLM_VERSION="$(python3 -c 'from importlib.metadata import version; print(version("vllm"))')" \
    && python3 -m pip install --no-cache-dir "vllm[audio]==${VLLM_VERSION}"
