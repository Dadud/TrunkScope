# TrunkScope all-in-one appliance: control plane, web UI, radiod, and Trunk Recorder.
# Pass /dev/bus/usb and a single appdata volume at /var/lib/trunkscope.

FROM node:22-bookworm-slim AS web-build
RUN corepack enable
WORKDIR /source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @trunkscope/web...
COPY apps/web apps/web
RUN pnpm --filter @trunkscope/web build

FROM rust:1.88-bookworm AS control-plane-build
WORKDIR /source
COPY Cargo.toml Cargo.lock ./
COPY crates/domain/Cargo.toml crates/domain/Cargo.toml
COPY apps/control-plane/Cargo.toml apps/control-plane/Cargo.toml
RUN mkdir -p crates/domain/src apps/control-plane/src \
    && printf 'pub fn placeholder() {}\n' > crates/domain/src/lib.rs \
    && printf 'fn main() {}\n' > apps/control-plane/src/main.rs \
    && cargo build --release -p trunkscope-control-plane \
    && rm -rf crates/domain/src apps/control-plane/src
COPY crates/domain/src crates/domain/src
COPY apps/control-plane/src apps/control-plane/src
RUN touch crates/domain/src/lib.rs apps/control-plane/src/main.rs \
    && cargo build --release -p trunkscope-control-plane

FROM ubuntu:24.04 AS radiod-build
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake make g++ libsoapysdr-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY native/radiod/CMakeLists.txt ./
COPY native/radiod/src src
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DTRUNKSCOPE_WITH_SOAPY=ON \
    && cmake --build build --parallel

FROM robotastic/trunk-recorder:latest AS runtime
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends supervisor \
        soapysdr-tools soapysdr-module-rtlsdr soapysdr-module-airspy soapysdr-module-remote \
    && rm -rf /var/lib/apt/lists/* \
    && install -d /var/lib/trunkscope/audio /var/lib/trunkscope/calls \
       /usr/share/trunkscope/web /config /etc/supervisor/conf.d

COPY --from=control-plane-build /source/target/release/trunkscope-control-plane /usr/local/bin/
COPY --from=radiod-build /source/build/trunkscope-radiod /usr/local/bin/
COPY --from=web-build /source/apps/web/dist /usr/share/trunkscope/web
COPY deploy/entrypoint.sh /usr/local/bin/trunkscope-entrypoint.sh
COPY deploy/run-decoder.sh /usr/local/bin/run-decoder.sh
COPY deploy/trunkscope-ingest.sh /usr/local/bin/trunkscope-ingest.sh
COPY deploy/supervisord.conf /etc/supervisor/conf.d/trunkscope.conf
COPY deploy/decoder/talkgroups.csv deploy/decoder/trs_tg_6364.csv /config/

RUN chmod 0755 \
      /usr/local/bin/trunkscope-entrypoint.sh \
      /usr/local/bin/run-decoder.sh \
      /usr/local/bin/trunkscope-ingest.sh \
      /usr/local/bin/trunkscope-control-plane \
      /usr/local/bin/trunkscope-radiod

ENV TRUNKSCOPE_BIND=0.0.0.0:8080 \
    TRUNKSCOPE_WEB_DIST=/usr/share/trunkscope/web \
    TRUNKSCOPE_STORAGE_PATH=/var/lib/trunkscope/audio \
    TRUNKSCOPE_SETTINGS_PATH=/var/lib/trunkscope/audio/settings.json \
    TRUNKSCOPE_SYSTEMS_PATH=/var/lib/trunkscope/audio/systems.json \
    TRUNKSCOPE_SCAN_LISTS_PATH=/var/lib/trunkscope/audio/scan-lists.json \
    TRUNKSCOPE_AUDIT_PATH=/var/lib/trunkscope/audio/audit.json \
    TRUNKSCOPE_SESSIONS_PATH=/var/lib/trunkscope/audio/conversation-sessions.json \
    TRUNKSCOPE_RECEIVERS_PATH=/var/lib/trunkscope/audio/receivers.json \
    TRUNKSCOPE_AUTH_PATH=/var/lib/trunkscope/audio/auth.json \
    TRUNKSCOPE_DECODER_CONFIG_PATH=/var/lib/trunkscope/audio/decoder/config.json \
    TRUNKSCOPE_CALLS_PATH=/var/lib/trunkscope/calls \
    TRUNKSCOPE_RADIOD_PATH=/usr/local/bin/trunkscope-radiod \
    TRUNKSCOPE_RADIO_MODE=decoder \
    TRUNKSCOPE_STATUS_SERVER=ws://127.0.0.1:8080/api/v1/decoder/status \
    TRUNKSCOPE_UPLOAD_SCRIPT=/usr/local/bin/trunkscope-ingest.sh \
    TRUNKSCOPE_PUBLIC_FEED=false \
    LD_LIBRARY_PATH=/opt/sdrplay/lib \
    SOAPY_SDR_PLUGIN_PATH=/opt/sdrplay/lib/SoapySDR/modules0.8 \
    RUST_LOG=trunkscope=info,tower_http=info

VOLUME ["/var/lib/trunkscope"]
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=8 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/v1/health || exit 1
ENTRYPOINT ["/usr/local/bin/trunkscope-entrypoint.sh"]
