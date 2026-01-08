import * as infisical from '@ptfm/infisical'
import * as cloudflare from '@pulumi/cloudflare'
import * as pulumi from '@pulumi/pulumi'
import { CloudflareEchSetting } from '../resources/cloudflare-ech'

export type CloudflareStackConfig = {
  cloudflareAccountId: string
  cloudflareApiToken: string
  clusterDomain: string
  clusterName: string
  clusterTargetIp: pulumi.Output<string>
  applicationDomains: string[]
  domainZoneIds: Record<string, string>
  applicationSecurityLevelMap: Record<string, string>
  applicationEnableEch: 'on' | 'off'
  applicationTargetIps: pulumi.Output<string>[]
  applicationRateLimits: Record<string, number>
  applicationBotProtectionMap?: Record<string, boolean>
  infisicalEnvironment: string
  infisicalClientId: string
  infisicalClientSecret: string
  infisicalProjectId: string
}

function domainKey(domain: string): string {
  return domain.replace(/\./g, '_')
}

export class CloudflareStack extends pulumi.ComponentResource {
  constructor(
    name: string,
    config: CloudflareStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:CloudflareStack', name, {}, opts)

    const infisicalProvider = new infisical.Provider(
      'infisical',
      {
        host: 'https://eu.infisical.com',
        auth: {
          universal: {
            clientId: config.infisicalClientId,
            clientSecret: config.infisicalClientSecret,
          },
        },
      },
      { parent: this },
    )

    const clusterZone = cloudflare.getZoneOutput(
      {
        filter: {
          account: { id: config.cloudflareAccountId },
          name: config.clusterDomain,
        },
      },
      { parent: this },
    )

    const clusterZoneId = clusterZone.zoneId!.apply((zoneId) => zoneId!)

    new cloudflare.ZoneSetting(
      'cluster_setting_always_use_https',
      {
        zoneId: clusterZoneId,
        settingId: 'always_use_https',
        value: 'on',
      },
      { parent: this },
    )

    new cloudflare.ZoneSetting(
      'cluster_setting_automatic_https_rewrites',
      {
        zoneId: clusterZoneId,
        settingId: 'automatic_https_rewrites',
        value: 'on',
      },
      { parent: this },
    )

    new cloudflare.ZoneSetting(
      'cluster_setting_ssl',
      {
        zoneId: clusterZoneId,
        settingId: 'ssl',
        value: 'full',
      },
      { parent: this },
    )

    new cloudflare.DnsRecord(
      'cluster_dns_record',
      {
        zoneId: clusterZoneId,
        name: `${config.clusterName}.${config.clusterDomain}`,
        type: 'A',
        content: config.clusterTargetIp,
        ttl: 1,
        proxied: false,
      },
      { parent: this },
    )

    new cloudflare.DnsRecord(
      'cluster_dns_record_webhooks',
      {
        zoneId: clusterZoneId,
        name: `${config.clusterName}-webhooks.${config.clusterDomain}`,
        type: 'A',
        content: config.clusterTargetIp,
        ttl: 1,
        proxied: true,
      },
      { parent: this },
    )

    const applicationZones: Record<
      string,
      pulumi.Output<cloudflare.GetZoneResult>
    > = {}

    for (const domain of config.applicationDomains) {
      applicationZones[domain] = cloudflare.getZoneOutput(
        {
          filter: { account: { id: config.cloudflareAccountId }, name: domain },
        },
        { parent: this },
      )
    }

    for (const [domain, zone] of Object.entries(applicationZones)) {
      const zoneId = zone.zoneId!.apply((zoneId) => zoneId!)

      new cloudflare.ZoneSetting(
        `application_setting_always_use_https_${domainKey(domain)}`,
        {
          zoneId,
          settingId: 'always_use_https',
          value: 'on',
        },
        { parent: this },
      )

      new cloudflare.ZoneSetting(
        `application_setting_automatic_https_rewrites_${domainKey(domain)}`,
        {
          zoneId,
          settingId: 'automatic_https_rewrites',
          value: 'on',
        },
        { parent: this },
      )

      new cloudflare.ZoneSetting(
        `application_setting_ssl_${domainKey(domain)}`,
        {
          zoneId,
          settingId: 'ssl',
          value: 'full',
        },
        { parent: this },
      )

      new cloudflare.ZoneSetting(
        `application_setting_security_level_${domainKey(domain)}`,
        {
          zoneId,
          settingId: 'security_level',
          value: config.applicationSecurityLevelMap[domain] || 'medium',
        },
        { parent: this },
      )

      new CloudflareEchSetting(
        `application_ech_setting_${domainKey(domain)}`,
        {
          zoneId,
          apiToken: config.cloudflareApiToken,
          value: config.applicationEnableEch,
        },
        { parent: this },
      )
    }

    for (const [domain, zone] of Object.entries(applicationZones)) {
      const zoneId = zone.zoneId!.apply((zoneId) => zoneId!)

      for (let i = 0; i < config.applicationTargetIps.length; i++) {
        const ip = config.applicationTargetIps[i]

        new cloudflare.DnsRecord(
          `application_dns_record_${domainKey(domain)}_${i}`,
          {
            zoneId,
            name: domain,
            type: 'A',
            content: ip,
            ttl: 1,
            proxied: true,
          },
          { parent: this },
        )

        new cloudflare.DnsRecord(
          `application_dns_record_wildcard_${domainKey(domain)}_${i}`,
          {
            zoneId,
            name: `*.${domain}`,
            type: 'A',
            content: ip,
            ttl: 1,
            proxied: true,
          },
          { parent: this },
        )
      }
    }

    const bypassTokens = infisical.getSecretsOutput(
      {
        envSlug: config.infisicalEnvironment,
        workspaceId: config.infisicalProjectId,
        folderPath: '/bypass-tokens',
      },
      { parent: this, provider: infisicalProvider },
    )

    for (const [domain, zone] of Object.entries(applicationZones)) {
      const zoneId = zone.zoneId!.apply((zoneId) => zoneId!)

      new cloudflare.Ruleset(
        `application_ruleset_${domainKey(domain)}`,
        {
          zoneId,
          name: 'bypass-waf',
          description: 'Bypass WAF',
          kind: 'zone',
          phase: 'http_request_firewall_custom',
          rules: [
            {
              enabled: true,
              description: 'Bypass WAF',
              action: 'skip',
              expression: pulumi.interpolate`(any(http.request.headers["x-bypass-waf"][*] eq "${bypassTokens.secrets.WAF.value}"))`,
              actionParameters: {
                phases: [
                  'http_ratelimit',
                  'http_request_firewall_managed',
                  'http_request_sbfm',
                ],
                products: ['uaBlock', 'bic', 'securityLevel'],
              },
              logging: {
                enabled: true,
              },
            },
          ],
        },
        { parent: this },
      )

      if (config.applicationBotProtectionMap?.[domain]) {
        new cloudflare.BotManagement(
          `application_bot_management_${domainKey(domain)}`,
          {
            zoneId,
            sbfmDefinitelyAutomated: 'block',
          },
          { parent: this },
        )
      }

      const domainLimits = Object.entries(config.applicationRateLimits).filter(
        ([limitDomain]) =>
          limitDomain === domain || limitDomain.endsWith(`.${domain}`),
      )

      if (domainLimits.length > 0) {
        new cloudflare.Ruleset(
          `application_rate_limit_${domainKey(domain)}`,
          {
            zoneId,
            name: `Rate limiting for ${domain}`,
            description: `Configurable rate limiting for ${domain}`,
            kind: 'zone',
            phase: 'http_ratelimit',
            rules: domainLimits.map(([limitDomain, limitPer10Sec]) => ({
              enabled: true,
              description: `${limitDomain} - ${limitPer10Sec} requests / 10s`,
              action: 'block',
              expression: `(http.host eq "${limitDomain}")`,
              ratelimit: {
                requestsPerPeriod: limitPer10Sec,
                period: 10,
                characteristics: ['ip.src', 'cf.colo.id'],
                mitigationTimeout: 60,
                requestsToOrigin: true,
              },
            })),
          },
          { parent: this },
        )
      }
    }

    this.registerOutputs()
  }
}
