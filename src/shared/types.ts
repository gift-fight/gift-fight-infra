import * as pulumi from '@pulumi/pulumi'

export type ComponentOutputs<T extends pulumi.ComponentResource> = Omit<
  T,
  'constructor' | keyof pulumi.ComponentResource
>
