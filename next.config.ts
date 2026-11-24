import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Quotes and invoices moved from the Construction module to the shared Billing module.
    return [
      { source: '/construction/quotes', destination: '/billing/quotes', permanent: true },
      { source: '/construction/quotes/:path*', destination: '/billing/quotes/:path*', permanent: true },
      { source: '/construction/invoices', destination: '/billing/invoices', permanent: true },
      { source: '/construction/invoices/:path*', destination: '/billing/invoices/:path*', permanent: true },
      { source: '/api/construction/invoices/:id/pdf', destination: '/api/billing/invoices/:id/pdf', permanent: true },
      { source: '/api/construction/quotes/:id/pdf', destination: '/api/billing/quotes/:id/pdf', permanent: true },
    ]
  },
};

export default nextConfig;
