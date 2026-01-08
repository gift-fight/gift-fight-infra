import * as hcloud from '@pulumi/hcloud'
import * as pulumi from '@pulumi/pulumi'
import * as tls from '@pulumi/tls'
import * as talos from '@pulumiverse/talos'
import { fromBase64 } from '../shared/base64'
import { K8sCredentialsOutput } from '../shared/k8s'
import { ComponentOutputs } from '../shared/types'

export type HetznerClusterStackConfig = {
  clusterName: string
  hcloudLocation: string
  numControlPlane: number
  numServiceWorkers: number
  numApplicationWorkersProduction: number
  hcloudServerTypeControlPlane: string
  hcloudServerTypeServiceWorker: string
  hcloudServerTypeApplicationWorker: string
}

export class HetznerClusterStack extends pulumi.ComponentResource {
  public readonly k8sCredentials: K8sCredentialsOutput
  public readonly kubeconfig: pulumi.Output<string>
  public readonly talosConfig: pulumi.Output<string>
  public readonly controlPlaneServers: hcloud.Server[]
  public readonly serviceWorkerServers: hcloud.Server[]
  public readonly applicationWorkerProductionServers: hcloud.Server[]
  public readonly controlPlaneIps: pulumi.Output<string>[]
  public readonly serviceWorkerIps: pulumi.Output<string>[]
  public readonly applicationWorkerIps: pulumi.Output<string>[]

  constructor(
    name: string,
    config: HetznerClusterStackConfig,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('gift-fight:infrastructure:HetznerClusterStack', name, {}, opts)

    const fakeTlsKey = new tls.PrivateKey(
      `${name}-fake-tls-key`,
      { algorithm: 'RSA', rsaBits: 4096 },
      { parent: this },
    )

    const hcloudSshKey = new hcloud.SshKey(
      `${name}-fake-ssh-key`,
      {
        name: `${config.clusterName}-fake-ssh-key`,
        publicKey: fakeTlsKey.publicKeyOpenssh,
      },
      { parent: this },
    )

    const talosImage = hcloud.getImageOutput(
      {
        withSelector: 'os=talos',
        withArchitecture: 'x86',
        mostRecent: true,
      },
      { parent: this },
    )

    const controlPlaneServers: hcloud.Server[] = []
    const controlPlaneIps: pulumi.Output<string>[] = []

    for (let i = 0; i < config.numControlPlane; i++) {
      const server = new hcloud.Server(
        `${name}-talos-control-plane-${i}`,
        {
          image: talosImage.id.apply((id) => String(id)),
          name: `${config.clusterName}-control-plane-${i}`,
          location: config.hcloudLocation,
          serverType: config.hcloudServerTypeControlPlane,
          sshKeys: [hcloudSshKey.id],
          publicNets: [
            {
              ipv4Enabled: true,
              ipv6Enabled: false,
            },
          ],
          labels: {
            cluster: config.clusterName,
            role: 'control-plane',
          },
        },
        { parent: this },
      )
      controlPlaneServers.push(server)
      controlPlaneIps.push(server.ipv4Address)
    }

    const applicationWorkerProductionServers: hcloud.Server[] = []
    const applicationWorkerIps: pulumi.Output<string>[] = []

    for (let i = 0; i < config.numApplicationWorkersProduction; i++) {
      const server = new hcloud.Server(
        `${name}-talos-application-worker-production-${i}`,
        {
          image: talosImage.id.apply((id) => String(id)),
          name: `${config.clusterName}-application-worker-${i}`,
          location: config.hcloudLocation,
          serverType: config.hcloudServerTypeApplicationWorker,
          sshKeys: [hcloudSshKey.id],
          publicNets: [
            {
              ipv4Enabled: true,
              ipv6Enabled: false,
            },
          ],
          labels: {
            cluster: config.clusterName,
            role: 'application-worker',
            environment: 'production',
          },
        },
        { parent: this },
      )
      applicationWorkerProductionServers.push(server)
      applicationWorkerIps.push(server.ipv4Address)
    }

    const serviceWorkerServers: hcloud.Server[] = []
    const serviceWorkerIps: pulumi.Output<string>[] = []

    for (let i = 0; i < config.numServiceWorkers; i++) {
      const server = new hcloud.Server(
        `${name}-talos-service-worker-${i}`,
        {
          image: talosImage.id.apply((id) => String(id)),
          name: `${config.clusterName}-service-worker-${i}`,
          location: config.hcloudLocation,
          serverType: config.hcloudServerTypeServiceWorker,
          sshKeys: [hcloudSshKey.id],
          publicNets: [
            {
              ipv4Enabled: true,
              ipv6Enabled: false,
            },
          ],
          labels: {
            cluster: config.clusterName,
            role: 'service-worker',
          },
        },
        { parent: this },
      )
      serviceWorkerServers.push(server)
      serviceWorkerIps.push(server.ipv4Address)
    }

    const secrets = new talos.machine.Secrets(
      `${name}-secrets`,
      {},
      { parent: this },
    )

    const clientConfiguration = talos.client.getConfigurationOutput(
      {
        clientConfiguration: secrets.clientConfiguration,
        clusterName: config.clusterName,
      },
      { parent: this },
    )

    // Use first control plane node IP as cluster endpoint
    const clusterEndpoint = pulumi.interpolate`https://${controlPlaneServers[0].ipv4Address}:6443`

    const cpConfiguration = talos.machine.getConfigurationOutput(
      {
        clusterName: config.clusterName,
        machineType: 'controlplane',
        clusterEndpoint,
        machineSecrets: secrets.machineSecrets,
      },
      { parent: this },
    )

    const workerConfiguration = talos.machine.getConfigurationOutput(
      {
        clusterName: config.clusterName,
        machineType: 'worker',
        clusterEndpoint,
        machineSecrets: secrets.machineSecrets,
      },
      { parent: this },
    )

    const applyList: talos.machine.ConfigurationApply[] = []

    for (const [i, node] of controlPlaneServers.entries()) {
      const apply = new talos.machine.ConfigurationApply(
        `${name}-control-plane-configuration-apply-${i}`,
        {
          clientConfiguration: secrets.clientConfiguration,
          machineConfigurationInput: cpConfiguration.machineConfiguration,
          node: node.ipv4Address,
          configPatches: [
            JSON.stringify({
              machine: {
                kubelet: {
                  extraArgs: {
                    'rotate-server-certificates': 'true',
                  },
                },
              },
              cluster: {
                extraManifests: [
                  'https://raw.githubusercontent.com/alex1989hu/kubelet-serving-cert-approver/main/deploy/standalone-install.yaml',
                ],
                network: {
                  cni: {
                    name: 'flannel',
                    flannel: {
                      extraArgs: ['--iface=eth0'],
                    },
                  },
                },
                controllerManager: {
                  extraArgs: {
                    'bind-address': '0.0.0.0',
                  },
                },
                scheduler: {
                  extraArgs: {
                    'bind-address': '0.0.0.0',
                  },
                },
                proxy: {
                  extraArgs: {
                    'metrics-bind-address': '0.0.0.0:10249',
                  },
                },
              },
            }),
          ],
        },
        { parent: this },
      )

      applyList.push(apply)
    }

    for (const [i, node] of applicationWorkerProductionServers.entries()) {
      const apply = new talos.machine.ConfigurationApply(
        `${name}-application-worker-production-configuration-apply-${i}`,
        {
          clientConfiguration: secrets.clientConfiguration,
          machineConfigurationInput: workerConfiguration.machineConfiguration,
          node: node.ipv4Address,
          configPatches: [
            JSON.stringify({
              machine: {
                kubelet: {
                  extraArgs: {
                    'rotate-server-certificates': 'true',
                  },
                  extraConfig: {
                    imageGCHighThresholdPercent: 70,
                    imageGCLowThresholdPercent: 65,
                  },
                },
                nodeLabels: {
                  role: 'application',
                  environment: 'production',
                },
              },
            }),
          ],
        },
        { parent: this },
      )

      applyList.push(apply)
    }

    for (const [i, node] of serviceWorkerServers.entries()) {
      const apply = new talos.machine.ConfigurationApply(
        `${name}-service-worker-configuration-apply-${i}`,
        {
          clientConfiguration: secrets.clientConfiguration,
          machineConfigurationInput: workerConfiguration.machineConfiguration,
          node: node.ipv4Address,
          configPatches: [
            JSON.stringify({
              machine: {
                kubelet: {
                  extraArgs: {
                    'rotate-server-certificates': 'true',
                  },
                  extraConfig: {
                    imageGCHighThresholdPercent: 70,
                    imageGCLowThresholdPercent: 65,
                  },
                },
                nodeLabels: {
                  role: 'service',
                },
              },
            }),
          ],
        },
        { parent: this },
      )

      applyList.push(apply)
    }

    const bootstrap = new talos.machine.Bootstrap(
      `${name}-bootstrap`,
      {
        node: controlPlaneServers[0].ipv4Address,
        clientConfiguration: secrets.clientConfiguration,
      },
      {
        parent: this,
        dependsOn: applyList,
      },
    )

    const kubeconfig = new talos.cluster.Kubeconfig(
      `${name}-kubeconfig`,
      {
        clientConfiguration: secrets.clientConfiguration,
        node: controlPlaneServers[0].ipv4Address,
      },
      {
        parent: this,
        dependsOn: [bootstrap],
      },
    )

    this.k8sCredentials = pulumi
      .all([
        kubeconfig.kubernetesClientConfiguration.host,
        kubeconfig.kubernetesClientConfiguration.clientCertificate,
        kubeconfig.kubernetesClientConfiguration.clientKey,
        kubeconfig.kubernetesClientConfiguration.caCertificate,
      ])
      .apply(([host, clientCertificate, clientKey, caCertificate]) => ({
        host,
        clientCertificate: fromBase64(clientCertificate),
        clientKey: fromBase64(clientKey),
        clusterCaCertificate: fromBase64(caCertificate),
      }))

    this.kubeconfig = kubeconfig.kubeconfigRaw
    this.talosConfig = clientConfiguration.talosConfig
    this.controlPlaneServers = controlPlaneServers
    this.serviceWorkerServers = serviceWorkerServers
    this.applicationWorkerProductionServers = applicationWorkerProductionServers
    this.controlPlaneIps = controlPlaneIps
    this.serviceWorkerIps = serviceWorkerIps
    this.applicationWorkerIps = applicationWorkerIps

    this.registerOutputs({
      talosConfig: this.talosConfig,
      kubeconfig: kubeconfig.kubeconfigRaw,
      k8sCredentials: this.k8sCredentials,
      controlPlaneServers: this.controlPlaneServers,
      serviceWorkerServers: this.serviceWorkerServers,
      applicationWorkerProductionServers:
        this.applicationWorkerProductionServers,
      controlPlaneIps: this.controlPlaneIps,
      serviceWorkerIps: this.serviceWorkerIps,
      applicationWorkerIps: this.applicationWorkerIps,
    } satisfies ComponentOutputs<HetznerClusterStack>)
  }
}
