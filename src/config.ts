import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  DIGITALOCEAN_TOKEN: z.string(),
  CLOUDFLARE_API_TOKEN: z.string(),
  CLOUDFLARE_R2_API_TOKEN: z.string(),
  CLOUDFLARE_R2_S3_ACCESS_KEY_ID: z.string(),
  CLOUDFLARE_R2_S3_ACCESS_KEY_SECRET: z.string(),
  GITHUB_OWNER: z.string(),
  GITHUB_FLUX_REPOSITORY: z.string(),
  GITHUB_TOKEN: z.string(),
  INFISICAL_PROJECT_ID: z.string(),
  INFISICAL_CLIENT_ID: z.string(),
  INFISICAL_CLIENT_SECRET: z.string(),
  INFISICAL_PRODUCTION_SERVICE_TOKEN: z.string(),
  GOOGLE_PROJECT: z.string(),
  HCLOUD_TOKEN: z.string(),
})

export const env = EnvSchema.parse(process.env)

export const domainZoneIds: Record<string, string> = {
  '<redacted>.app': '<redacted-zone-id>',
  '<redacted>-k8s.in': '<redacted-zone-id>',
  '<redacted>-cloud.top': '<redacted-zone-id>',
}

export const applicationDomains = ['<redacted>.app', '<redacted>-cloud.top']

export const applicationOrganizationMap: Record<string, string> = {
  '<redacted>.app': '<Redacted> Ltd.',
  '<redacted>-cloud.top': '<Redacted> Cloud Ltd.',
}

export const applicationRateLimits: Record<string, number> = {
  'api.<redacted>.app': 120,
  '<redacted>.app': 180,
}

// Cloudflare security level
// Available values: 'off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'
export const applicationSecurityLevelMap: Record<string, string> = {}

export const applicationBotProtectionMap: Record<string, boolean> = {
  '<redacted>.app': true,
}
