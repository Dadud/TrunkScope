FROM rust:1.85-bookworm AS build
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
    && apt-get install -y --no-install-recommends cmake g++ libsoapysdr-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY native/radiod/CMakeLists.txt ./
COPY native/radiod/src src
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DTRUNKSCOPE_WITH_SOAPY=ON \
    && cmake --build build --parallel

FROM ubuntu:24.04 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget libsoapysdr0.8 \
       soapysdr-tools soapysdr-module-remote soapysdr-module-rtlsdr soapysdr-module-airspy \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system trunkscope \
    && useradd --system --gid trunkscope --home-dir /var/lib/trunkscope trunkscope \
    && install -d -o trunkscope -g trunkscope /var/lib/trunkscope/audio
COPY --from=build /source/target/release/trunkscope-control-plane /usr/local/bin/
COPY --from=radiod-build /source/build/trunkscope-radiod /usr/local/bin/
USER trunkscope
ENV TRUNKSCOPE_BIND=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/trunkscope-control-plane"]
