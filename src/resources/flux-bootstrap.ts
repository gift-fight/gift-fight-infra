import * as command from '@pulumi/command'
import * as pulumi from '@pulumi/pulumi'

export type FluxBootstrapArgs = {
  githubOwner: pulumi.Input<string>
  githubRepository: pulumi.Input<string>
  githubToken: pulumi.Input<string>
  clusterName: pulumi.Input<string>
  kubeconfig: pulumi.Input<string>
  componentsExtras?: pulumi.Input<string[]>
}

export class FluxBootstrap extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: FluxBootstrapArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('custom:resource:FluxBootstrap', name, args, opts)

    const createCommand = (command: pulumi.Input<string>) => {
      return pulumi.interpolate`
        export GITHUB_TOKEN=${args.githubToken}
        TEMP_DIR=$(mktemp -d) && \
        echo '${args.kubeconfig}' > $TEMP_DIR/kubeconfig.yaml && \
        ${command} && \
        rm -rf $TEMP_DIR
      `
    }

    const bootstrapText = pulumi
      .all([
        args.githubOwner,
        args.githubRepository,
        args.clusterName,
        args.componentsExtras,
      ])
      .apply(([githubOwner, githubRepository, clusterName, componentsExtras]) =>
        [
          'flux bootstrap github',
          `--kubeconfig=$TEMP_DIR/kubeconfig.yaml`,
          `--owner=${githubOwner}`,
          `--repository=${githubRepository}`,
          `--path=clusters/${clusterName}`,
          '--read-write-key',
          componentsExtras &&
            `--components-extra=${componentsExtras.join(',')}`,
        ]
          .filter(Boolean)
          .join(' '),
      )

    const bootstrapCommand = createCommand(bootstrapText)

    const uninstallCommand = createCommand(
      'flux uninstall --silent --kubeconfig=$TEMP_DIR/kubeconfig.yaml',
    )

    new command.local.Command(
      `${name}-flux-bootstrap`,
      {
        create: bootstrapCommand,
        update: bootstrapCommand,
        delete: uninstallCommand,
      },
      { parent: this },
    )

    this.registerOutputs()
  }
}
