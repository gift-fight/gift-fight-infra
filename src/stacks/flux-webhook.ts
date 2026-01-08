import * as github from '@pulumi/github'
import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'
import * as crypto from 'crypto'

export type FluxWebhookStackConfig = {
  kubeconfig: pulumi.Input<string>
  githubToken: string
  githubOrganization: string
  githubRepository: string
  clusterDomain: string
  clusterName: string
}

export class FluxWebhookStack extends pulumi.ComponentResource {
  constructor(
    name: string,
    config: FluxWebhookStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:FluxWebhookStack', name, {}, opts)

    const githubProvider = new github.Provider(
      'github',
      {
        owner: config.githubOrganization,
        token: config.githubToken,
      },
      { parent: this },
    )

    const k8sProvider = new k8s.Provider(
      'kubernetes',
      { kubeconfig: config.kubeconfig },
      { parent: this },
    )

    const webhookToken = new random.RandomString(
      'flux-webhook-token',
      {
        length: 40,
        special: false,
      },
      { parent: this },
    )

    const webhookTokenSecret = new k8s.core.v1.Secret(
      'flux-webhook-token-secret',
      {
        metadata: {
          name: 'webhook-token',
          namespace: 'flux-system',
        },
        type: 'Opaque',
        stringData: {
          token: webhookToken.result,
        },
      },
      { provider: k8sProvider, parent: this },
    )

    const webhookReceiver = new k8s.apiextensions.CustomResource(
      'flux-webhook-receiver',
      {
        apiVersion: 'notification.toolkit.fluxcd.io/v1',
        kind: 'Receiver',
        metadata: {
          name: 'flux-system',
          namespace: 'flux-system',
        },
        spec: {
          type: 'github',
          events: ['ping', 'push'],
          secretRef: {
            name: webhookTokenSecret.metadata.name,
          },
          resources: [
            {
              kind: 'GitRepository',
              name: 'flux-system',
            },
          ],
        },
      },
      { provider: k8sProvider, parent: this },
    )

    const tokenHash = pulumi.all([webhookToken.result]).apply(([token]) => {
      const hash = crypto.createHash('sha256')
      hash.update(`${token}flux-systemflux-system`)
      return hash.digest('hex')
    })

    const webhookUrl = pulumi.interpolate`https://${config.clusterName}-webhooks.${config.clusterDomain}/flux/hook/${tokenHash}`

    new github.RepositoryWebhook(
      'flux-webhook',
      {
        repository: config.githubRepository,
        events: ['push'],
        configuration: {
          url: webhookUrl,
          contentType: 'form',
          secret: webhookToken.result,
          insecureSsl: false,
        },
      },
      { provider: githubProvider, dependsOn: [webhookReceiver], parent: this },
    )

    this.registerOutputs()
  }
}
