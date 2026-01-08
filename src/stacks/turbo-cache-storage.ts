import * as cloudflare from '@pulumi/cloudflare'
import * as github from '@pulumi/github'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

export type TurboCacheStorageStackConfig = {
  cloudflareAccountId: string
  cloudflareApiToken: string
  cloudflareS3AccessKeyId: string
  cloudflareS3AccessKeySecret: string
  kubeconfig: pulumi.Input<string>
  githubToken: string
  githubOrganization: string
  githubRepositories: string[]
}

export class TurboCacheStorageStack extends pulumi.ComponentResource {
  constructor(
    name: string,
    config: TurboCacheStorageStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:TurboCacheStorageStack', name, {}, opts)

    const githubProvider = new github.Provider(
      `${name}-github`,
      {
        owner: config.githubOrganization,
        token: config.githubToken,
      },
      { parent: this },
    )

    const k8sProvider = new k8s.Provider(
      `${name}-kubernetes`,
      { kubeconfig: config.kubeconfig },
      { parent: this },
    )

    const cloudflareProvider = new cloudflare.Provider(
      `${name}-cloudflare`,
      {
        apiToken: config.cloudflareApiToken,
      },
      { parent: this },
    )

    const namespace = new k8s.core.v1.Namespace(
      `${name}-turbo_cache_namespace`,
      {
        metadata: {
          name: 'turbo-cache',
        },
      },
      { provider: k8sProvider, parent: this, retainOnDelete: true },
    )

    const turboCacheBucket = new cloudflare.R2Bucket(
      `${name}-turbo_cache_bucket`,
      {
        accountId: config.cloudflareAccountId,
        name: `${name}-turbo-cache-storage`,
        location: 'EEUR', // Europe East
      },
      { parent: this, provider: cloudflareProvider },
    )

    const turboToken = new random.RandomPassword(
      `${name}-turbo_cache_token`,
      {
        length: 32,
        special: false,
      },
      { parent: this },
    )

    for (const repository of config.githubRepositories) {
      const repoKey = repository.replace(/[^a-zA-Z0-9]/g, '_')
      new github.ActionsSecret(
        `${name}-github_turbo_token_secret_${repoKey}`,
        {
          repository,
          secretName: 'TURBO_TOKEN',
          plaintextValue: turboToken.result,
        },
        { provider: githubProvider, parent: this },
      )
    }

    new k8s.core.v1.Secret(
      `${name}-turbo_cache_secret`,
      {
        metadata: {
          name: 'turbo-cache-credentials',
          namespace: namespace.metadata.name,
        },
        type: 'Opaque',
        stringData: {
          'turbo-token': turboToken.result,
          'cloudflare-account-id': config.cloudflareAccountId,
          'cloudflare-access-key-id': config.cloudflareS3AccessKeyId,
          'cloudflare-secret-access-key': config.cloudflareS3AccessKeySecret,
          'cloudflare-bucket': turboCacheBucket.name,
          'cloudflare-endpoint': pulumi.interpolate`https://${config.cloudflareAccountId}.r2.cloudflarestorage.com`,
        },
      },
      { provider: k8sProvider, parent: this, dependsOn: [namespace] },
    )

    this.registerOutputs({
      bucketName: turboCacheBucket.name,
      namespace: namespace.metadata.name,
    })
  }
}
