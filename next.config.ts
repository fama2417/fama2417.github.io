import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/portal/labs": ["./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/@tesseract.js-data/spa/**/*"],
    "/api/portal/imaging": ["./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/@tesseract.js-data/spa/**/*"],
  },
  async rewrites() {
    // OHIF (servido por Orthanc) usa rutas absolutas /ohif y /dicom-web: se enrutan al proxy autenticado.
    return [
      { source: "/ohif/:path*", destination: "/api/pacs/ohif/:path*" },
      { source: "/dicom-web/:path*", destination: "/api/pacs/dicom-web/:path*" },
    ];
  },
};

export default nextConfig;
