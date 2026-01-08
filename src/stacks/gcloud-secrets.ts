import * as kubernetes from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { toBase64 } from '../shared/base64'
import { ComponentOutputs } from '../shared/types'

export type GcloudSecretsStackConfig = {
  kubeconfig: pulumi.Input<string>
  googleCredsNamespace: string
  registryCredsNamespace: string
  backupsCredentialsSecretName: string
  registryRegion: string
  registryPullerEmail: pulumi.Input<string>
  registryKey: pulumi.Input<string>
  backupKey: pulumi.Input<string>
}

export class GcloudSecretsStack extends pulumi.ComponentResource {
  public readonly googleCredsNamespace: kubernetes.core.v1.Namespace
  public readonly registryCredsNamespace: kubernetes.core.v1.Namespace
  public readonly registryCredentials: kubernetes.core.v1.Secret
  public readonly registryPuller: kubernetes.core.v1.ServiceAccount
  public readonly backupCredentials: kubernetes.core.v1.Secret

  constructor(
    name: string,
    config: GcloudSecretsStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:GcloudSecretsStack', name, {}, opts)

    const k8sProvider = new kubernetes.Provider(
      `${name}-kubernetes`,
      { kubeconfig: config.kubeconfig },
      { parent: this },
    )

    this.googleCredsNamespace = new kubernetes.core.v1.Namespace(
      `${name}-google-creds`,
      {
        metadata: {
          name: config.googleCredsNamespace,
        },
      },
      { provider: k8sProvider, parent: this, retainOnDelete: true },
    )

    this.registryCredsNamespace = new kubernetes.core.v1.Namespace(
      `${name}-registry-creds`,
      {
        metadata: {
          name: config.registryCredsNamespace,
        },
      },
      { provider: k8sProvider, parent: this, retainOnDelete: true },
    )

    const dockerConfigJson = pulumi
      .all([
        config.registryKey,
        config.registryPullerEmail,
        config.registryRegion,
      ])
      .apply(([key, email, region]) => {
        const authString = `_json_key:${key}`
        const auth = toBase64(authString)

        return JSON.stringify({
          auths: {
            [`${region}-docker.pkg.dev`]: {
              username: '_json_key',
              password: key,
              email,
              auth,
            },
          },
        })
      })

    this.registryCredentials = new kubernetes.core.v1.Secret(
      `${name}-registry-credentials`,
      {
        metadata: {
          name: 'google-registry-creds',
          namespace: this.registryCredsNamespace.metadata.name,
        },
        type: 'kubernetes.io/dockerconfigjson',
        stringData: {
          '.dockerconfigjson': dockerConfigJson,
        },
      },
      { provider: k8sProvider, parent: this },
    )

    this.registryPuller = new kubernetes.core.v1.ServiceAccount(
      `${name}-registry-puller`,
      {
        metadata: {
          name: 'google-registry-puller',
          namespace: this.registryCredsNamespace.metadata.name,
        },
        imagePullSecrets: [
          {
            name: this.registryCredentials.metadata.name,
          },
        ],
      },
      { provider: k8sProvider, parent: this },
    )

    this.backupCredentials = new kubernetes.core.v1.Secret(
      `${name}-backup-credentials`,
      {
        metadata: {
          name: config.backupsCredentialsSecretName,
          namespace: this.googleCredsNamespace.metadata.name,
        },
        stringData: {
          key: config.backupKey,
        },
      },
      { provider: k8sProvider, parent: this },
    )

    this.registerOutputs({
      googleCredsNamespace: this.googleCredsNamespace,
      registryCredsNamespace: this.registryCredsNamespace,
      registryCredentials: this.registryCredentials,
      registryPuller: this.registryPuller,
      backupCredentials: this.backupCredentials,
    } satisfies ComponentOutputs<GcloudSecretsStack>)
  }
}
