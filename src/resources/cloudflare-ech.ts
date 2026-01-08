import * as pulumi from '@pulumi/pulumi'

type CloudflareEchResourceArgs = {
  zoneId: pulumi.Input<string>
  apiToken: pulumi.Input<string>
  value: pulumi.Input<string>
}

type CloudflareEchResourceInputs = {
  zoneId: string
  apiToken: string
  value: string
}

class CloudflareEchProvider implements pulumi.dynamic.ResourceProvider {
  async create(
    inputs: CloudflareEchResourceInputs,
  ): Promise<pulumi.dynamic.CreateResult> {
    const result = await this.updateEchSetting(inputs)
    return { id: `${inputs.zoneId}/ech`, outs: { ...inputs, result } }
  }

  async update(
    _id: string,
    _olds: CloudflareEchResourceInputs,
    news: CloudflareEchResourceInputs,
  ): Promise<pulumi.dynamic.UpdateResult> {
    const result = await this.updateEchSetting(news)
    return { outs: { ...news, result } }
  }

  async delete(_id: string, props: CloudflareEchResourceInputs): Promise<void> {
    await this.updateEchSetting({ ...props, value: 'on' })
  }

  private async updateEchSetting(
    inputs: CloudflareEchResourceInputs,
  ): Promise<string> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${inputs.zoneId}/settings/ech`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${inputs.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          value: inputs.value,
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Failed to update ECH settings: ${response.status} - ${errorText}`,
      )
    }

    const data = await response.json()
    return JSON.stringify(data)
  }
}

export class CloudflareEchSetting extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: CloudflareEchResourceArgs,
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      new CloudflareEchProvider(),
      name,
      {
        ...args,
        result: undefined,
      },
      opts,
    )
  }
}
