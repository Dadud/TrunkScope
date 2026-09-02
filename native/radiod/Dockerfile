FROM ubuntu:24.04 AS build
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake make g++ libsoapysdr-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY native/radiod/CMakeLists.txt ./
COPY native/radiod/src src
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DTRUNKSCOPE_WITH_SOAPY=ON \
    && cmake --build build --parallel

FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsoapysdr0.8 soapysdr-tools \
       soapysdr-module-remote soapysdr-module-rtlsdr soapysdr-module-airspy ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /source/build/trunkscope-radiod /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/trunkscope-radiod"]
CMD ["--list-devices"]
