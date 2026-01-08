import * as pulumi from '@pulumi/pulumi'

export type K8sCredentialsOutput = pulumi.Output<{
  host: string
  clientCertificate: string
  clientKey: string
  clusterCaCertificate: string
}>
