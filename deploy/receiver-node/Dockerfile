FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends soapysdr-tools soapysdr-module-remote \
       soapysdr-module-rtlsdr soapysdr-module-airspy ca-certificates usbutils \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 55132/tcp 55132/udp
ENTRYPOINT ["SoapySDRServer"]
CMD ["--bind"]
