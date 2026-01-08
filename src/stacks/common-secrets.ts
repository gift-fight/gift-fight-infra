import * as kubernetes from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

export type CommonSecretsStackConfig = {
  kubeconfig: pulumi.Input<string>
  infisicalSecretsNamespace: string
  infisicalProductionServiceToken: string
  doToken: string
  hcloudToken: string
}

export class CommonSecretsStack extends pulumi.ComponentResource {
  constructor(
    name: string,
    config: CommonSecretsStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:CommonSecretsStack', name, {}, opts)

    const kubernetesProvider = new kubernetes.Provider(
      `${name}-kubernetes`,
      { kubeconfig: config.kubeconfig },
      { parent: this },
    )

    const infisicalSecretsNamespace = new kubernetes.core.v1.Namespace(
      `${name}-infisical-secrets`,
      {
        metadata: {
          name: config.infisicalSecretsNamespace,
        },
      },
      { provider: kubernetesProvider, parent: this, retainOnDelete: true },
    )

    new kubernetes.core.v1.Secret(
      `${name}-infisical-production-service-token`,
      {
        metadata: {
          name: 'infisical-service-token-production',
          namespace: infisicalSecretsNamespace.metadata.name,
        },
        stringData: {
          infisicalToken: config.infisicalProductionServiceToken,
        },
      },
      { provider: kubernetesProvider, parent: this },
    )

    new kubernetes.core.v1.Secret(
      `${name}-digitalocean`,
      {
        metadata: {
          name: 'digitalocean',
          namespace: 'kube-system',
        },
        stringData: {
          'access-token': config.doToken,
        },
      },
      { provider: kubernetesProvider, parent: this },
    )

    new kubernetes.core.v1.Secret(
      `${name}-hcloud`,
      {
        metadata: {
          name: 'hcloud',
          namespace: 'kube-system',
        },
        stringData: {
          token: config.hcloudToken,
        },
      },
      { provider: kubernetesProvider, parent: this },
    )

    this.registerOutputs()
  }
}
