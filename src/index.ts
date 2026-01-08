import {
  applicationBotProtectionMap,
  applicationDomains,
  applicationOrganizationMap,
  applicationRateLimits,
  applicationSecurityLevelMap,
  domainZoneIds,
  env,
} from './config'
import { FluxBootstrap } from './resources/flux-bootstrap'
import { fromBase64 } from './shared/base64'
import { CloudflareStack } from './stacks/cloudflare'
import { CloudflareTlsStack } from './stacks/cloudflare-tls'
import { CommonSecretsStack } from './stacks/common-secrets'
import { FluxWebhookStack } from './stacks/flux-webhook'
import { GcloudStack } from './stacks/gcloud'
import { GcloudCleanupStack } from './stacks/gcloud-cleanup'
import { GcloudSecretsStack } from './stacks/gcloud-secrets'
import { HetznerClusterStack } from './stacks/hetzner-cluster-stack'
import { TurboCacheStorageStack } from './stacks/turbo-cache-storage'

export = async () => {
  const hetznerCluster = new HetznerClusterStack('hetzner-cluster', {
    clusterName: 'hetzner',
    hcloudLocation: 'hel1', // Helsinki, Finland
    numControlPlane: 1,
    numServiceWorkers: 1,
    numApplicationWorkersProduction: 1,
    hcloudServerTypeControlPlane: 'cx22', // 2 vCPU Intel, 4GB RAM
    hcloudServerTypeServiceWorker: 'cx22', // 2 vCPU Intel, 4GB RAM
    hcloudServerTypeApplicationWorker: 'cx32', // 4 vCPU Intel, 8GB RAM
  })

  const mainCloudflare = new CloudflareStack('main-cloudflare', {
    cloudflareAccountId: '<redacted-account-id>',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
    clusterDomain: '<redacted>-k8s.in',
    clusterName: 'hetzner',
    clusterTargetIp: hetznerCluster.controlPlaneIps[0],
    applicationDomains,
    domainZoneIds,
    applicationSecurityLevelMap,
    applicationBotProtectionMap,
    applicationEnableEch: 'off',
    applicationTargetIps: hetznerCluster.applicationWorkerIps,
    applicationRateLimits,
    infisicalEnvironment: 'prod',
    infisicalProjectId: env.INFISICAL_PROJECT_ID,
    infisicalClientId: env.INFISICAL_CLIENT_ID,
    infisicalClientSecret: env.INFISICAL_CLIENT_SECRET,
  })

  const registryRegion = 'europe-west4'

  const gcloudStack = new GcloudStack('main-gcloud', {
    googleProject: env.GOOGLE_PROJECT,
    registryRegion,
    backupsBucketName: '<redacted>-backups',
    backupsBucketRegion: 'eu',
    backupsAccountName: 'backups',
  })

  new GcloudCleanupStack(
    'main-gcloud-cleanup',
    {
      projectId: env.GOOGLE_PROJECT,
      registryRegion,
      registryRepository: gcloudStack.dockerRegistry.name,
      schedulerRegion: 'europe-west1',
      cleanupAccountName: 'cleanup',
    },
    { dependsOn: [gcloudStack] },
  )

  new CommonSecretsStack('hetzner-common-secrets', {
    kubeconfig: hetznerCluster.kubeconfig,
    infisicalSecretsNamespace: 'infisical-system-secrets',
    infisicalProductionServiceToken: env.INFISICAL_PRODUCTION_SERVICE_TOKEN,
    doToken: env.DIGITALOCEAN_TOKEN,
    hcloudToken: env.HCLOUD_TOKEN,
  })

  new CloudflareTlsStack(
    'hetzner-cloudflare-tls',
    {
      applicationDomains,
      applicationOrganizationMap,
      kubeconfig: hetznerCluster.kubeconfig,
    },
    { dependsOn: mainCloudflare },
  )

  new GcloudSecretsStack(
    'hetzner-gcloud-secrets',
    {
      kubeconfig: hetznerCluster.kubeconfig,
      googleCredsNamespace: 'google-creds',
      registryCredsNamespace: 'registry-creds',
      backupsCredentialsSecretName: 'production-backups-creds',
      registryRegion,
      registryPullerEmail: gcloudStack.registryPuller.email,
      registryKey: gcloudStack.registryKey.privateKey.apply(fromBase64),
      backupKey: gcloudStack.backupKey.privateKey.apply(fromBase64),
    },
    {
      dependsOn: [gcloudStack, hetznerCluster],
    },
  )

  const fluxBootstrap = new FluxBootstrap(
    'hetzner-flux-bootstrap',
    {
      githubOwner: env.GITHUB_OWNER,
      githubRepository: env.GITHUB_FLUX_REPOSITORY,
      githubToken: env.GITHUB_TOKEN,
      clusterName: 'hetzner',
      kubeconfig: hetznerCluster.kubeconfig,
      componentsExtras: [
        'image-reflector-controller',
        'image-automation-controller',
      ],
    },
    { dependsOn: hetznerCluster },
  )

  new FluxWebhookStack(
    'hetzner-flux-webhook',
    {
      kubeconfig: hetznerCluster.kubeconfig,
      githubToken: env.GITHUB_TOKEN,
      githubOrganization: env.GITHUB_OWNER,
      githubRepository: env.GITHUB_FLUX_REPOSITORY,
      clusterDomain: '<redacted>-k8s.in',
      clusterName: 'hetzner',
    },
    { dependsOn: [hetznerCluster, fluxBootstrap] },
  )

  new TurboCacheStorageStack(
    'core-turbo-cache',
    {
      cloudflareAccountId: '<redacted-account-id>',
      cloudflareApiToken: env.CLOUDFLARE_R2_API_TOKEN,
      cloudflareS3AccessKeyId: env.CLOUDFLARE_R2_S3_ACCESS_KEY_ID,
      cloudflareS3AccessKeySecret: env.CLOUDFLARE_R2_S3_ACCESS_KEY_SECRET,
      kubeconfig: hetznerCluster.kubeconfig,
      githubToken: env.GITHUB_TOKEN,
      githubOrganization: env.GITHUB_OWNER,
      githubRepositories: ['<redacted>'],
    },
    { dependsOn: [hetznerCluster] },
  )

  return {
    kubeconfig: hetznerCluster.kubeconfig,
    talosConfig: hetznerCluster.talosConfig,
  }
}
