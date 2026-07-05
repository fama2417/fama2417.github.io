import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // OHIF (servido por Orthanc) usa rutas absolutas /ohif y /dicom-web: se enrutan al proxy autenticado.
    return [
      { source: "/ohif/:path*", destination: "/api/pacs/ohif/:path*" },
      { source: "/dicom-web/:path*", destination: "/api/pacs/dicom-web/:path*" },
    ];
  },
};

export default nextConfig;
